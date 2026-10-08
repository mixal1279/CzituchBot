'use strict';

/** Call the Groq SDK with transport options separate from the JSON request body. */
function createGroqCompletion(groqClient, payload, { signal } = {}) {
  if (!groqClient?.chat?.completions?.create) {
    throw new TypeError('Groq chat.completions.create is unavailable');
  }
  const requestOptions = signal ? { signal } : {};
  return groqClient.chat.completions.create(payload, requestOptions);
}

/**
 * Allocate a validator timeout from the request's remaining wall-clock budget.
 * Return null when starting the validator would leave too little time for the
 * next validator/fallback to run.
 */
function computeValidatorTimeout(remainingMs, {
  maxTimeoutMs = 9000,
  reserveMs = 6500,
  minTimeoutMs = 4000,
} = {}) {
  const remaining = Number(remainingMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  if (remaining < minTimeoutMs + reserveMs) return null;
  const timeoutMs = Math.min(maxTimeoutMs, remaining - reserveMs);
  return timeoutMs >= minTimeoutMs ? Math.floor(timeoutMs) : null;
}

/**
 * Bound a generation attempt while preserving a minimum reserve for validation
 * or another provider. Do not start a request that can only run for a tiny
 * fraction of a second; those attempts create timeout noise without real fallback.
 */
function computeGenerationTimeout(remainingMs, {
  maxTimeoutMs = 9000,
  reserveMs = 4500,
  minTimeoutMs = 4000,
} = {}) {
  const remaining = Number(remainingMs);
  if (!Number.isFinite(remaining) || remaining <= reserveMs) return null;
  const timeoutMs = Math.min(maxTimeoutMs, remaining - reserveMs);
  return timeoutMs >= minTimeoutMs ? Math.floor(timeoutMs) : null;
}

module.exports = { createGroqCompletion, computeValidatorTimeout, computeGenerationTimeout };
