'use strict';

const CLASSIFIERS = Object.freeze({
  quota: /(?:429|quota|rate.?limit|tokens per day|tokens per minute|TPD|TPM|credit|insufficient)/i,
  auth: /(?:401|403|unauthori[sz]ed|forbidden|invalid.*key|api.?key|missing.*key|brak .*key)/i,
  invalid_request: /(?:invalid.*request|bad request|400|invalid.*schema|malformed.*json|json.*invalid)/i,
  transient: /(?:timeout|timed ?out|ETIMEDOUT|ECONNRESET|5\d\d|temporar|overloaded|unavailable|fetch failed|aborted|abort|network error|socket hang up)/i,
  provider_cooldown: /(?:generation cooldown|provider cooldown|temporarily disabled)/i,
});

const DETAIL_CLASSIFIERS = Object.freeze([
  ['budget_exhausted', /(?:budget|budżet|limit(?:e|u)? (?:model|generation)|model calls exhausted)/i],
  ['timeout_abort', /(?:timeout|timed ?out|ETIMEDOUT|AbortError|operation was aborted|abort(?:ed)?)/i],
  ['invalid_json', /(?:invalid json|malformed json|json parse|niepoprawny json)/i],
  ['schema_rejection', /(?:schema.{0,24}(?:reject|invalid|fail)|(?:reject|invalid|fail).{0,24}schema|niespełniający lokalnego kontraktu|validator JSON.*contract rejection)/i],
  ['empty_response', /(?:empty content|empty response|pusty content|pusta odpowiedź)/i],
  ['provider_cooldown', /(?:generation cooldown|provider cooldown|temporarily disabled)/i],
  ['transport_error', /(?:transport error|network error|fetch failed|socket hang up|ECONNRESET|connection refused)/i],
  ['provider_unavailable', /(?:provider unavailable|brak .*api.?key|provider.*(?:unavailable|niedostęp)|fallback.*niedostęp|validator.*niedostęp|\bunavailable\b)/i],
  ['validator_rejection', /(?:validator rejected|validator rejection|grounded_reject|unsupported_or_unverified_claims)/i],
]);

function classifyFailure(error = '') {
  const status = error && typeof error === 'object' ? String(error.status || '').toLowerCase() : '';
  if (status === 'accepted' || status === 'soft_accepted') return null;
  if (status === 'rejected') return 'validator_rejection';
  if (status === 'inconclusive') return 'validator_inconclusive';
  if (status === 'unavailable' && ![error.message, error.reason, error.error, error.diagnostic].some(Boolean)) {
    return 'provider_unavailable';
  }
  const text = error && typeof error === 'object'
    ? [error.message, error.reason, error.error, error.diagnostic].filter(Boolean).join(' ')
    : String(error?.message || error || '');
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

function nextFallbacks({ failure = 'unknown', attempted = [], failedProviders = [], maxFallbacks = null } = {}) {
  const failed = new Set(Array.isArray(failedProviders) ? failedProviders : []);
  let remaining = GENERATION_FALLBACK_CHAIN.filter(
    provider => !attempted.includes(provider) && !failed.has(provider),
  );
  // Validator rejection is a semantic signal, not a provider error. If a caller
  // explicitly supplies it, skip the expensive 120B retry; classifyFailure()
  // never manufactures this category from generic API error text.
  if (failure === 'grounded_reject') {
    remaining = remaining.filter(provider => !provider.includes('120b'));
  }
  const limit = Math.max(
    0,
    Number(maxFallbacks ?? process.env.AI_MAX_FALLBACK_STEPS ?? GENERATION_FALLBACK_CHAIN.length),
  );
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

function shouldRetryFailure(failure) {
  // Retry means "try another provider", not "repeat the same failing endpoint".
  // Auth errors are useful only for cross-provider fallback.
  return ['transient', 'timeout_abort', 'transport_error', 'empty_response', 'invalid_json', 'schema_rejection', 'provider_unavailable', 'budget_exhausted', 'quota', 'auth', 'invalid_request', 'provider_cooldown', 'unknown'].includes(failure);
}

module.exports = {
  GENERATION_FALLBACK_CHAIN,
  classifyFailure,
  nextFallbacks,
  selectRepairFallbacks,
  shouldRetryFailure,
};
