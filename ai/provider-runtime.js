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
 * Enforce a caller-owned wall-clock deadline even if an SDK/provider does not
 * promptly settle its promise after AbortSignal.abort(). The signal still asks
 * the transport to stop; the race ensures the pipeline can move on regardless.
 */
function awaitWithAbortTimeout(promise, timeoutMs, controller, label = 'provider request') {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    const error = new Error(`${label} has no remaining timeout budget`);
    error.name = 'TimeoutError';
    return Promise.reject(error);
  }
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller?.abort(); } catch (_) {}
      const error = new Error(`${label} timed out after ${Math.floor(timeout)}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, Math.max(1, Math.floor(timeout)));
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

/**
 * Choose a reserve for later validator/fallback slots from the remaining deadline.
 * Keep at least 2.5s for a final response; skip calls that cannot fit a 4s attempt.
 */
function computeValidatorReserveMs(remainingMs, currentSlot = 1, maxValidators = 3) {
  const remaining = Number(remainingMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  const slot = Math.max(1, Math.floor(Number(currentSlot) || 1));
  const maxSlots = Math.max(slot, Math.floor(Number(maxValidators) || 3));
  const futureSlots = maxSlots - slot;
  if (futureSlots >= 2) {
    if (remaining >= 14500) return 10500;
    if (remaining >= 10500) return 6500;
    if (remaining >= 6500) return 2500;
    return 2500;
  }
  if (futureSlots === 1) {
    if (remaining >= 10500) return 6500;
    if (remaining >= 6500) return 2500;
    return 2500;
  }
  return 2500;
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
  maxTimeoutMs = 12000,
  // Keep enough time for the final validator: 4 s minimum plus its 2.5 s reserve.
  reserveMs = 6500,
  minTimeoutMs = 4000,
} = {}) {
  const remaining = Number(remainingMs);
  if (!Number.isFinite(remaining) || remaining <= reserveMs) return null;
  const timeoutMs = Math.min(maxTimeoutMs, remaining - reserveMs);
  return timeoutMs >= minTimeoutMs ? Math.floor(timeoutMs) : null;
}

module.exports = { createGroqCompletion, awaitWithAbortTimeout, withReasoningHeadroom, computeValidatorTimeout, computeValidatorReserveMs, computeGenerationTimeout };
