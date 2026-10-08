'use strict';

const CLASSIFIERS = Object.freeze({
  quota: /(?:429|quota|rate.?limit|tokens per day|tokens per minute|TPD|TPM|credit|insufficient)/i,
  auth: /(?:401|403|unauthori[sz]ed|forbidden|invalid.*key|api.?key|missing.*key|brak .*key)/i,
  invalid_request: /(?:invalid.*request|bad request|400|invalid.*schema|malformed.*json|json.*invalid)/i,
  transient: /(?:timeout|timed ?out|ETIMEDOUT|ECONNRESET|5\d\d|temporar|overloaded|unavailable|fetch failed|aborted|abort)/i,
});

function classifyFailure(error = '') {
  const text = String(error?.message || error || '');
  if (CLASSIFIERS.quota.test(text)) return 'quota';
  if (CLASSIFIERS.auth.test(text)) return 'auth';
  if (CLASSIFIERS.invalid_request.test(text)) return 'invalid_request';
  if (CLASSIFIERS.transient.test(text)) return 'transient';
  return 'unknown';
}

const GENERATION_FALLBACK_CHAIN = [
  'groq:openai/gpt-oss-120b',
  'groq:openai/gpt-oss-20b',
  'gemini:gemini-3.8-flash',
  'gemini:gemini-3.5-flash-lite',
  'openrouter:default',
  'xkiro:default',
];

function nextFallbacks({ failure = 'unknown', attempted = [], failedProviders = [], maxFallbacks = null } = {}) {
  const failed = new Set(Array.isArray(failedProviders) ? failedProviders : []);
  const remaining = GENERATION_FALLBACK_CHAIN.filter(
    provider => !attempted.includes(provider) && !failed.has(provider),
  );
  const limit = Math.max(
    0,
    Number(maxFallbacks ?? process.env.AI_MAX_FALLBACK_STEPS ?? GENERATION_FALLBACK_CHAIN.length),
  );
  return remaining.slice(0, limit);
}

function shouldRetryFailure(failure) {
  return ['transient', 'quota', 'auth', 'invalid_request', 'unknown'].includes(failure);
}

module.exports = {
  GENERATION_FALLBACK_CHAIN,
  classifyFailure,
  nextFallbacks,
  shouldRetryFailure,
};