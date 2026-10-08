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
  maxTimeoutMs = 6000,
  reserveMs = 1500,
  minTimeoutMs = 1500,
} = {}) {
  const remaining = Number(remainingMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  if (remaining < minTimeoutMs + reserveMs) return null;
  const timeoutMs = Math.min(maxTimeoutMs, remaining - reserveMs);
  return timeoutMs >= minTimeoutMs ? Math.floor(timeoutMs) : null;
}

module.exports = { createGroqCompletion, computeValidatorTimeout };
