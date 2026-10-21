'use strict';

const CLASSIFIERS = Object.freeze({
  quota: /(?:(?<![\d.,])429(?!\d)|quota|rate.?limit|tokens per day|tokens per minute|TPD|TPM|credit|insufficient)/i,
  auth: /(?:(?<![\d.,])40[13](?!\d)|unauthori[sz]ed|forbidden|invalid.*key|api.?key|missing.*key|brak .*key)/i,
  invalid_request: /(?:invalid.*request|bad request|(?<![\d.,])400(?!\d)|invalid.*schema|malformed.*json|json.*invalid)/i,
  transient: /(?:timeout|timed ?out|ETIMEDOUT|ECONNRESET|(?<![\d.,])5\d\d(?!\d|\s*(?:tokens?|ms|chars?|znak|bytes?|words|slów))|temporar|overloaded|unavailable|fetch failed|aborted|abort|network error|socket hang up)/i,
  provider_cooldown: /(?:generation cooldown|provider cooldown|temporarily disabled)/i,
});

const SCHEMA_REJECTION = /(?:schema.{0,24}(?:reject|invalid|fail)|(?:reject|invalid|fail).{0,24}schema|invalid json|malformed json|json parse|niespełniający lokalnego kontraktu)/i;

const DETAIL_CLASSIFIERS = Object.freeze([
  ['budget_exhausted', /(?:budget|budżet|limit(?:e|u)? (?:model|generation)|model calls exhausted|(?:120b|global).*(?:request cap|request quota|circuit breaker|quota wyczerpana))/i],
  ['timeout_abort', /(?:timeout|timed ?out|ETIMEDOUT|AbortError|operation was aborted|abort(?:ed)?)/i],
  ['invalid_json', /(?:invalid json|malformed json|json parse|niepoprawny json)/i],
  ['schema_rejection', SCHEMA_REJECTION],
  ['empty_response', /(?:finish_reason.{0,24}(?:length|max_tokens)|MAX_TOKENS|truncated|ucięta odpowiedź|odpowiedź ucięta|empty content|empty response|pusty content|pusta odpowiedź)/i],
  ['provider_cooldown', /(?:generation cooldown|provider cooldown|temporarily disabled)/i],
  ['transport_error', /(?:transport[_ -]?error|network[_ -]?error|fetch failed|socket hang up|ECONNRESET|connection refused)/i],
  ['provider_unavailable', /(?:provider unavailable|brak .*api.?key|provider.*(?:unavailable|niedostęp)|fallback.*niedostęp|validator.*niedostęp|\bunavailable\b)/i],
  ['validator_rejection', /(?:validator rejected|validator rejection|grounded_reject|unsupported_or_unverified_claims)/i],
]);

// Diagnostyka dostawcy (formatProviderError) to duży JSON z polami takimi jak
// timeoutMs czy requestContract. Klasyfikowanie całego tekstu regexami dawało
// fałszywe trafienia (np. 429 TPD jako timeout_abort przez słowo "timeoutMs").
// Klasyfikujemy po rdzeniu: kod HTTP + komunikat błędu.
function extractErrorCore(raw) {
  const text = String(raw || '');
  const msg = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const st = text.match(/"status"\s*:\s*(\d{3})(?!\d)/);
  if (!msg && !st) return text;
  let message = msg ? msg[1] : '';
  try { message = JSON.parse('"' + message + '"'); } catch (_) { /* zostaw surowy */ }
  const core = [st ? 'HTTP ' + st[1] : '', message].filter(Boolean).join(' ').trim();
  return core || text;
}

function classifyFailure(error = '') {
  const status = error && typeof error === 'object' ? String(error.status || '').toLowerCase() : '';
  if (status === 'accepted') return null;
  if (status === 'soft_accepted') return 'validator_rejection';
  if (status === 'rejected') {
    const rejectionText = [error.message, error.reason, error.error, error.diagnostic].filter(Boolean).join(' ');
    return SCHEMA_REJECTION.test(rejectionText) ? 'schema_rejection' : 'validator_rejection';
  }
  if (status === 'inconclusive') return 'validator_inconclusive';
  if (status === 'unavailable' && ![error.message, error.reason, error.error, error.diagnostic].some(Boolean)) {
    return 'provider_unavailable';
  }
  // xKiro documents stable HTTP status/type/code values. Classify those before
  // human-readable messages, which may change or omit quota-related wording.
  const structuredStatus = error && typeof error === 'object'
    ? Number(error.httpStatus ?? error.statusCode ?? (typeof error.status === 'number' ? error.status : 0))
    : 0;
  const rawError = typeof error === 'string' ? error : '';
  const diagnosticStatus = rawError.match(/"status"\s*:\s*(\d{3})(?!\d)/);
  const httpStatus = structuredStatus || (diagnosticStatus ? Number(diagnosticStatus[1]) : 0);
  const statusContext = error && typeof error === 'object'
    ? [error.message, error.code, error.type, error.diagnostic].filter(Boolean).join(' ')
    : rawError;
  // Some providers use 429 for overload/capacity pressure rather than quota exhaustion.
  if (httpStatus === 429 && /(?:high demand|overloaded|temporarily unavailable|capacity exceeded)/i.test(statusContext)) return 'transient';
  if ([402, 429].includes(httpStatus)) return 'quota';
  if ([400, 422, 404].includes(httpStatus)) return 'invalid_request';
  if ([401, 403].includes(httpStatus)) return 'auth';
  if ([408, 500, 502, 503, 504, 529].includes(httpStatus)) return 'transient';
  const text = error && typeof error === 'object'
    ? [error.message, error.reason, error.error, error.diagnostic].filter(Boolean).map(extractErrorCore).join(' ')
    : extractErrorCore(String(error?.message || error || ''));
  // Some providers use HTTP 429 for temporary capacity pressure, not exhausted quota.
  if (/(?:high demand|overloaded|temporarily unavailable|capacity exceeded)/i.test(text)) return 'transient';
  // HTTP 402 is a credit/payment quota even if the provider omits quota wording.
  if (/(?:HTTP\s*402|"status"\s*:\s*402)/i.test(text)) return 'quota';

  for (const [type, pattern] of DETAIL_CLASSIFIERS) {
    if (pattern.test(text)) return type;
  }
  if (CLASSIFIERS.quota.test(text)) return 'quota';
  if (CLASSIFIERS.auth.test(text)) return 'auth';
  if (CLASSIFIERS.invalid_request.test(text)) return 'invalid_request';
  if (CLASSIFIERS.transient.test(text)) return 'transient';
  if (CLASSIFIERS.provider_cooldown.test(text)) return 'provider_cooldown';
  return 'unknown';
}

const GENERATION_FALLBACK_CHAIN = [
  'groq:openai/gpt-oss-120b',
  'groq:openai/gpt-oss-20b',
  'gemini:gemini-3.8-flash',
  'gemini:gemini-3.5-flash-lite',
  'xkiro:default',
  'openrouter:default',
];
// Semantic repair is latency- and budget-sensitive. The normal generation
// chain above stays unchanged; only the repair path uses this preference.
//
// Kolejność ma tu znaczenie wykonawcze: na cykl repairu mieści się JEDNA próba
// dostawcy (próg 13,5 s = 3 s na próbę + 10,5 s rezerwy na walidator), więc
// pierwszy kandydat musi być tym, który faktycznie odpowiada. W live benchmarku
// (2026-10-21) Gemini zajął 12 s i nie zwrócił werdyktu w 5/5 przypadków,
// a xKiro nigdy nie zdążył — obaj stali na początku listy, a model, który
// odpowiadał w 0,6–1,5 s, był dopiero czwarty.
const REPAIR_FALLBACK_PREFERENCE = [
  'groq:openai/gpt-oss-20b',
  'groq:openai/gpt-oss-120b',
  'gemini:gemini-3.5-flash-lite',
  'xkiro:default',
  'openrouter:default',
  'gemini:gemini-3.8-flash',
];

function configuredMaxFallbackSteps(value = process.env.AI_MAX_FALLBACK_STEPS) {
  if (value == null || String(value).trim() === '') return GENERATION_FALLBACK_CHAIN.length;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : GENERATION_FALLBACK_CHAIN.length;
}

const quotaBlockedUntil = new Map();

function resetProviderQuotaCooldowns() {
  quotaBlockedUntil.clear();
}

function geminiGenerationCooldownMsFromError(error) {
  const message = String(error?.message || error || '');
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
  // Gemini documents HTTP 402 as depleted Prepay credits; retrying cannot help
  // until billing is fixed, so suppress repeated calls for a longer interval.
  if (status === 402 || /(?:HTTP\s*402|\b402\b|prepay credit balance.{0,30}(?:deplet|exhaust)|credit balance.{0,40}(?:deplet|exhaust|insufficient))/i.test(message)) {
    return 24 * 60 * 60 * 1000;
  }

  // Honor Retry-After when it is available (including the normalized string
  // attached by retryAfterHint); otherwise distinguish daily quota from bursts.
  const retryAfter = message.match(/retry[- ]after\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?)?/i);
  if (retryAfter) return Math.max(1_000, Math.ceil(Number(retryAfter[1]) * 1000));

  const dailyQuota = /(?:tokens?\s*(?:per|\/)\s*day|\bTPD\b|daily (?:token|usage|request) (?:allowance|quota|limit)|daily allowance exhausted)/i.test(message);
  if (dailyQuota) return 24 * 60 * 60 * 1000;

  if (status === 429 || /(?:HTTP\s*429|\b429\b|quota|rate.?limit|resource.?exhausted|limit:)/i.test(message)) return 90_000;
  return 0;
}

function openRouterErrorMessage(httpStatus, data, retryAfter = '') {
  const error = data?.error && typeof data.error === 'object' ? data.error : {};
  const status = Number(error.code || httpStatus || 0);
  const metadata = error.metadata && typeof error.metadata === 'object' ? error.metadata : {};
  const parts = [
    status ? `HTTP ${status}` : '',
    String(error.message || 'OpenRouter returned an error'),
    metadata.error_type ? `error_type=${metadata.error_type}` : '',
    metadata.provider_code ? `provider_code=${metadata.provider_code}` : '',
    metadata.limit_source ? `limit_source=${metadata.limit_source}` : '',
    retryAfter ? `Retry-After=${String(retryAfter).replace(/^Retry-After=/i, '')}` : '',
  ].filter(Boolean);
  return parts.join('; ');
}

function retryAfterHint(source, now = Date.now()) {
  const headers = source?.headers || source?.response?.headers || source;
  let raw = null;
  try { raw = headers?.get?.('retry-after') ?? headers?.get?.('Retry-After') ?? null; } catch (_) {}
  if (raw == null && headers && typeof headers === 'object') {
    raw = headers['retry-after'] ?? headers['Retry-After'] ?? headers.retryAfter ?? null;
  }
  if (raw == null || String(raw).trim() === '') return '';
  const value = String(raw).trim();
  const parsedDate = Date.parse(value);
  const seconds = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value)
    : (Number.isFinite(parsedDate) ? Math.max(0, (parsedDate - now) / 1000) : NaN);
  return Number.isFinite(seconds) ? `Retry-After=${Math.max(0, seconds)}s` : '';
}

function quotaCooldownMsFromError(error) {
  const message = String(error?.message || error || '');
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
  const isPaymentRequired = status === 402 || /(?:HTTP\s*402|"status"\s*:\s*402)/i.test(message);
  const isOverload = /(?:high demand|overloaded|temporarily unavailable|capacity exceeded)/i.test(message);
  const configured = Number(process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS) || 60_000;
  let retryAfterMs = null;
  let hasRetryAfterHeader = false;

  // First, honor any Retry-After coming from headers on the error/response object.
  try {
    const headers = error?.headers || error?.response?.headers || error;
    let rawHeader = null;
    if (headers) {
      if (typeof headers.get === 'function') rawHeader = headers.get('retry-after') ?? headers.get('Retry-After') ?? null;
      else if (typeof headers === 'object') rawHeader = headers['retry-after'] ?? headers['Retry-After'] ?? headers.retryAfter ?? null;
    }
    if (rawHeader != null && String(rawHeader).trim() !== '') {
      const v = String(rawHeader).trim();
      const parsedDate = Date.parse(v);
      const seconds = /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : (Number.isFinite(parsedDate) ? Math.max(0, (parsedDate - Date.now()) / 1000) : NaN);
      if (Number.isFinite(seconds)) { retryAfterMs = Math.max(0, seconds * 1000); hasRetryAfterHeader = true; }
    }
  } catch (_) {}

  // Message-based 'retry-after' tokens (some providers embed this in text)
  const retryAfterMatch = message.match(/retry[- ]after\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?)?/i);
  if (retryAfterMatch && !hasRetryAfterHeader) {
    retryAfterMs = Math.max(retryAfterMs || 0, Number(retryAfterMatch[1]) * 1000);
  }

  // Groq uses "try again in 1h2m3s", "3m22.176s", "5.43s", and sometimes
  // omits the seconds component ("2m" or "1h30m").
  const tryAgainMatch = message.match(/try again in\s+(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m(?!s))?\s*(?:(\d+(?:\.\d+)?)s)?/i);
  if (tryAgainMatch && !hasRetryAfterHeader && (tryAgainMatch[1] || tryAgainMatch[2] || tryAgainMatch[3])) {
    const hours = Number(tryAgainMatch[1] || 0);
    const minutes = Number(tryAgainMatch[2] || 0);
    const seconds = Number(tryAgainMatch[3] || 0);
    const groqRetryAfterMs = Math.max(0, (hours * 3600 + minutes * 60 + seconds) * 1000);
    // Honor provider-supplied short TPM retry windows; the global cooldown
    // is a fallback only when the response gives no retry duration.
    retryAfterMs = Math.max(retryAfterMs || 0, groqRetryAfterMs, 1_000);
  }

  // HTTP 402 means credits are exhausted; do not retry it blindly.
  // Honor Retry-After on 402 only for the documented OpenRouter in-flight-budget
  // exception. Other 402 responses use a conservative local cooldown.
  if (isPaymentRequired && error?.allowPaymentRequiredRetryAfter !== true) {
    return 24 * 60 * 60 * 1000;
  }
  // xKiro also returns 429 when a free model's rolling daily token allowance is
  // exhausted. If the response did not provide an authoritative Retry-After,
  // suppress repeated calls instead of probing the same exhausted allowance
  // every minute. Burst/rate-limit 429s retain the short configurable cooldown.
  const dailyQuota = /(?:tokens?\s*(?:per|\/)\s*day|\bTPD\b|daily (?:token|usage|request) (?:allowance|quota|limit)|daily allowance exhausted)/i.test(message)
    || /(?:quota_exceeded|daily_quota_exceeded|free_tokens_exhausted)/i.test(String(error?.code || error?.type || ''));
  if (dailyQuota && retryAfterMs === null) return 24 * 60 * 60 * 1000;
  if (retryAfterMs !== null) {
    // A valid provider Retry-After is authoritative for retryable responses.
    // Do not silently extend a short wait to the local 60s default.
    return Math.max(1_000, Math.ceil(retryAfterMs));
  }
  return isOverload ? 60_000 : configured;
}

function normalizeProviderEndpoint(provider) {
  const endpoint = String(provider || '').trim();
  const separator = endpoint.indexOf(':');
  if (separator <= 0) return '';
  const providerName = endpoint.slice(0, separator).toLowerCase();
  let model = endpoint.slice(separator + 1).trim();
  if (!['groq', 'gemini', 'xkiro', 'openrouter'].includes(providerName) || !model) return '';
  if (model === 'default' && providerName === 'xkiro') {
    model = process.env.XKIRO_MODEL || 'qwen/qwen3.5-397b-a17b:free';
  } else if (model === 'default' && providerName === 'openrouter') {
    model = process.env.OPENROUTER_GENERATOR_MODEL || process.env.AI_GENERATOR_MODEL || 'openai/gpt-oss-120b';
  }
  return `${providerName}:${model}`;

}
function markProviderQuota(provider, cooldownMs = Number(process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS) || 60_000) {
  const endpoint = normalizeProviderEndpoint(provider);
  if (!endpoint) return [];
  const duration = Math.max(1_000, Number(cooldownMs) || 60_000);
  const until = Math.max(quotaBlockedUntil.get(endpoint) || 0, Date.now() + duration);
  quotaBlockedUntil.set(endpoint, until);
  return [endpoint];
}

function isProviderQuotaBlocked(provider, now = Date.now()) {
  const endpoint = normalizeProviderEndpoint(provider);
  if (!endpoint) return false;
  const providerName = endpoint.slice(0, endpoint.indexOf(':'));
  const keys = [endpoint, `${providerName}:*`];
  let blockedUntil = 0;
  for (const key of keys) {
    const until = quotaBlockedUntil.get(key) || 0;
    if (until && until <= now) quotaBlockedUntil.delete(key);
    else blockedUntil = Math.max(blockedUntil, until);
  }
  return blockedUntil > now;
}

function nextFallbacks({ failure = 'unknown', attempted = [], failedProviders = [], maxFallbacks = null } = {}) {
  const failed = new Set(Array.isArray(failedProviders) ? failedProviders : []);
  let remaining = GENERATION_FALLBACK_CHAIN.filter(
    provider => !attempted.includes(provider) && !failed.has(provider) && !isProviderQuotaBlocked(provider),
  );
  // Validator rejection is a semantic signal, not a provider error. If a caller
  // explicitly supplies it, skip the expensive 120B retry; classifyFailure()
  // never manufactures this category from generic API error text.
  if (failure === 'grounded_reject') {
    remaining = remaining.filter(provider => !provider.includes('120b'));
  }
  const limit = maxFallbacks == null
    ? configuredMaxFallbackSteps()
    : Math.max(0, Number.isFinite(Number(maxFallbacks)) ? Math.floor(Number(maxFallbacks)) : GENERATION_FALLBACK_CHAIN.length);
  return remaining.slice(0, limit);
}

function selectRepairFallbacks({ failedProviders = [], exclude = [], availableProviders = null, maxFallbacks = 1 } = {}) {
  const blocked = new Set([...(failedProviders || []), ...(exclude || [])]);
  const available = Array.isArray(availableProviders) ? new Set(availableProviders) : null;
  const candidates = nextFallbacks({
    failure: 'grounded_reject',
    failedProviders: [...blocked],
    maxFallbacks: GENERATION_FALLBACK_CHAIN.length,
  })
    .filter(provider => !available || available.has(provider));
  const preference = new Map(REPAIR_FALLBACK_PREFERENCE.map((provider, index) => [provider, index]));
  return candidates
    .sort((a, b) => (preference.get(a) ?? REPAIR_FALLBACK_PREFERENCE.length) - (preference.get(b) ?? REPAIR_FALLBACK_PREFERENCE.length))
    .slice(0, Math.max(0, Number(maxFallbacks) || 0));
}

function filterAvailableFallbacks(candidates, availableProviders) {
  const available = new Set(Array.isArray(availableProviders) ? availableProviders : []);
  return (Array.isArray(candidates) ? candidates : []).filter(provider => available.has(provider));
}

function repairBudgetBlockReason({
  remainingMs,
  generations,
  maxGenerations,
  repairGenerations,
  maxRepairGenerations,
  modelCalls,
  maxModelCalls,
} = {}) {
  if (Number.isFinite(Number(remainingMs)) && Number(remainingMs) <= 0) return 'request_deadline_exhausted';
  if (Number.isFinite(Number(modelCalls)) && Number.isFinite(Number(maxModelCalls)) && Number(modelCalls) >= Number(maxModelCalls)) {
    return 'model_calls_exhausted';
  }
  if (Number.isFinite(Number(generations)) && Number.isFinite(Number(maxGenerations)) && Number(generations) >= Number(maxGenerations)) {
    return 'generation_budget_exhausted';
  }
  if (Number.isFinite(Number(repairGenerations)) && Number.isFinite(Number(maxRepairGenerations)) && Number(repairGenerations) >= Number(maxRepairGenerations)) {
    return 'repair_generation_budget_exhausted';
  }
  // Repair requires 3s generation plus the 10.5s validation/fallback reserve.
  if (Number.isFinite(Number(remainingMs)) && Number(remainingMs) < 13500) {
    return 'insufficient_time_for_fallback';
  }
  return null;
}

function shouldOpenQuotaCircuit(error) {
  // This breaker lasts an hour and is process-wide for the expensive 120B model.
  // A generic 429/rate-limit is handled by the endpoint cooldown and must not
  // trigger the long breaker. Open it only for billing or clearly daily quota.
  // OpenRouter's documented retryable in-flight budget 402 is also excluded.
  const text = String(error?.message || error || '');
  if (/openrouter_in_flight_budget/i.test(text) && /retry[- ]after/i.test(text)) return false;
  return /(?:"status"\s*:\s*402|HTTP\s*402|payment required|insufficient (?:credits?|quota)|credit balance.{0,40}(?:deplet|exhaust|insufficient)|tokens? per day|\bTPD\b|daily (?:token|request|usage) quota|quota exceeded)/i.test(text);
}

function shouldRetryFailure(failure) {
  // Retry means "try another provider", not "repeat the same failing endpoint".
  // Auth errors are useful only for cross-provider fallback.
  return ['transient', 'timeout_abort', 'transport_error', 'empty_response', 'invalid_json', 'schema_rejection', 'provider_unavailable', 'budget_exhausted', 'quota', 'auth', 'invalid_request', 'provider_cooldown', 'validator_inconclusive', 'unknown'].includes(failure);
}

module.exports = {
  GENERATION_FALLBACK_CHAIN,
  REPAIR_FALLBACK_PREFERENCE,
  configuredMaxFallbackSteps,
  resetProviderQuotaCooldowns,
  quotaCooldownMsFromError,
  geminiGenerationCooldownMsFromError,
  retryAfterHint,
  openRouterErrorMessage,
  shouldOpenQuotaCircuit,
  markProviderQuota,
  isProviderQuotaBlocked,
  classifyFailure,
  nextFallbacks,
  selectRepairFallbacks,
  filterAvailableFallbacks,
  repairBudgetBlockReason,
  shouldRetryFailure,
};
