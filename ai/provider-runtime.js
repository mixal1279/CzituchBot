'use strict';

// Modele gpt-oss liczą tokeny rozumowania do max_completion_tokens. Bez zapasu
// reasoning potrafi zjeść cały budżet i zostaje pusta odpowiedź (finish_reason=length).
const REASONING_HEADROOM_TOKENS = { 'openai/gpt-oss-120b': 1500, default: 800 };
const REASONING_MIN_ANSWER_TOKENS = 300;
const REASONING_TOKEN_CEILING = 4000;
const boostedPayloads = new WeakSet();

/**
 * Add reasoning headroom to max_completion_tokens for gpt-oss models.
 * Mutates the payload in place (callers/tests rely on object identity) and is
 * idempotent per payload object. Other models and payloads without
 * reasoning_effort are left untouched.
 */
function withReasoningHeadroom(payload) {
  if (!payload || typeof payload !== 'object' || boostedPayloads.has(payload)) return payload;
  const model = String(payload.model || '');
  if (!model.startsWith('openai/gpt-oss') || !payload.reasoning_effort) return payload;
  const base = Number(payload.max_completion_tokens);
  if (!Number.isFinite(base) || base <= 0) return payload;
  const headroom = REASONING_HEADROOM_TOKENS[model] ?? REASONING_HEADROOM_TOKENS.default;
  const answerBudget = Math.max(base, REASONING_MIN_ANSWER_TOKENS);
  payload.max_completion_tokens = Math.min(answerBudget + headroom, Math.max(base, REASONING_TOKEN_CEILING));
  boostedPayloads.add(payload);
  return payload;
}

/** Call the Groq SDK with transport options separate from the JSON request body. */
function createGroqCompletion(groqClient, payload, { signal } = {}) {
  if (!groqClient?.chat?.completions?.create) {
    throw new TypeError('Groq chat.completions.create is unavailable');
  }
  withReasoningHeadroom(payload);
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

module.exports = { createGroqCompletion, withReasoningHeadroom, computeValidatorTimeout, computeGenerationTimeout };
