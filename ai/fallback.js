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
  const text = error && typeof error === 'object'
    ? [error.message, error.reason, error.error, error.diagnostic].filter(Boolean).map(extractErrorCore).join(' ')
    : extractErrorCore(String(error?.message || error || ''));
  // Some providers use HTTP 429 for temporary capacity pressure, not exhausted quota.
  if (/(?:high demand|overloaded|temporarily unavailable|capacity exceeded)/i.test(text)) return 'transient';
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

function configuredMaxFallbackSteps(value = process.env.AI_MAX_FALLBACK_STEPS) {
  if (value == null || String(value).trim() === '') return GENERATION_FALLBACK_CHAIN.length;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : GENERATION_FALLBACK_CHAIN.length;
}

const quotaBlockedUntil = new Map();

function resetProviderQuotaCooldowns() {
  quotaBlockedUntil.clear();
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
  const isOverload = /(?:high demand|overloaded|temporarily unavailable|capacity exceeded)/i.test(message);
  const configured = Number(process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS) || 60_000;
  let retryAfterMs = null;

  const retryAfterMatch = message.match(/retry[- ]after\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?)?/i);
  if (retryAfterMatch) {
    retryAfterMs = Math.max(0, Number(retryAfterMatch[1]) * 1000);
  }

  // Groq uses "try again in 1h2m3s", "3m22.176s", "5.43s", and sometimes
  // omits the seconds component ("2m" or "1h30m").
  const tryAgainMatch = message.match(/try again in\s+(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m(?!s))?\s*(?:(\d+(?:\.\d+)?)s)?/i);
  if (tryAgainMatch && (tryAgainMatch[1] || tryAgainMatch[2] || tryAgainMatch[3])) {
    const hours = Number(tryAgainMatch[1] || 0);
    const minutes = Number(tryAgainMatch[2] || 0);
    const seconds = Number(tryAgainMatch[3] || 0);
    const groqRetryAfterMs = Math.max(0, (hours * 3600 + minutes * 60 + seconds) * 1000);
    // Honor provider-supplied short TPM retry windows; the global cooldown
    // is a fallback only when the response gives no retry duration.
    retryAfterMs = Math.max(retryAfterMs || 0, groqRetryAfterMs, 1_000);
  }

  if (retryAfterMs !== null) {
    return Math.max(isOverload ? 60_000 : 1_000, Math.ceil(retryAfterMs));
  }
  return isOverload ? 60_000 : configured;
}

function normalizeProviderEndpoint(provider) {
  const endpoint = String(provider || '').trim();
  const separator = endpoint.indexOf(':');
  if (separator <= 0) return '';
  const providerName = endpoint.slice(0, separator).toLowerCase();
  const model = endpoint.slice(separator + 1).trim();
  if (!['groq', 'gemini', 'xkiro', 'openrouter'].includes(providerName) || !model) return '';
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
  const until = quotaBlockedUntil.get(endpoint);
  if (!until) return false;
  if (until <= now) {
    quotaBlockedUntil.delete(provider);
    return false;
  }
  return true;
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
  return nextFallbacks({
    failure: 'grounded_reject',
    failedProviders: [...blocked],
    maxFallbacks: GENERATION_FALLBACK_CHAIN.length,
  })
    .filter(provider => !available || available.has(provider))
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
  // A repair needs a minimum generation window plus a reserved validation/fallback window.
  if (Number.isFinite(Number(remainingMs)) && Number(remainingMs) < 8500) {
    return 'insufficient_time_for_fallback';
  }
  return null;
}

function shouldOpenQuotaCircuit(error) {
  // HTTP 429 can mean temporary capacity pressure; only true quota failures
  // should trip the long-lived process-wide model circuit breaker.
  return classifyFailure(error) === 'quota';
}

function shouldRetryFailure(failure) {
  // Retry means "try another provider", not "repeat the same failing endpoint".
  // Auth errors are useful only for cross-provider fallback.
  return ['transient', 'timeout_abort', 'transport_error', 'empty_response', 'invalid_json', 'schema_rejection', 'provider_unavailable', 'budget_exhausted', 'quota', 'auth', 'invalid_request', 'provider_cooldown', 'validator_inconclusive', 'unknown'].includes(failure);
}

module.exports = {
  GENERATION_FALLBACK_CHAIN,
  configuredMaxFallbackSteps,
  resetProviderQuotaCooldowns,
  quotaCooldownMsFromError,
  retryAfterHint,
  markProviderQuota,
  isProviderQuotaBlocked,
  classifyFailure,
  nextFallbacks,
  selectRepairFallbacks,
  filterAvailableFallbacks,
  repairBudgetBlockReason,
  shouldOpenQuotaCircuit,
  shouldRetryFailure,
};
