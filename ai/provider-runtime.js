'use strict';

// Modele gpt-oss liczą tokeny rozumowania do max_completion_tokens. Bez zapasu
// reasoning potrafi zjeść cały budżet i zostaje pusta odpowiedź (finish_reason=length).
const REASONING_HEADROOM_TOKENS = { 'openai/gpt-oss-120b': 1500, default: 800 };
const REASONING_MIN_ANSWER_TOKENS = 300;
const REASONING_TOKEN_CEILING = 4000;
const boostedPayloads = new WeakSet();

// --- Lokalny licznik TPM dla Groq -------------------------------------------
// Walidator i generator naprawczy współdzielą model gpt-oss-20b, a jego limit
// on_demand to 8000 tokenów/min. Pojedyncze żądanie to ~4-5k tokenów (prompt +
// max_completion_tokens), więc drugie żądanie w tej samej minucie dostawało 429
// i otwierało circuit breaker. Liczymy zużycie w oknie 60 s i pozwalamy
// wołającym pominąć model z góry, zamiast wysyłać żądanie skazane na 429.
// Limity innych modeli są wyłączone, dopóki nie podasz ich w AI_GROQ_TPM_LIMITS
// (JSON, np. {"openai/gpt-oss-120b":8000}). AI_GROQ_TPM_GUARD=0 wyłącza licznik.
const GROQ_TPM_WINDOW_MS = 60_000;
const GROQ_TPM_DEFAULT_LIMITS = { 'openai/gpt-oss-20b': 8000 };
const GROQ_TPM_SAFETY = 0.95;
const GROQ_TPM_DEFAULT_ESTIMATE = 4500;
const groqTpmEvents = new Map();

function groqTpmLimitFor(model) {
  if (process.env.AI_GROQ_TPM_GUARD === '0') return null;
  let overrides = {};
  try { overrides = JSON.parse(process.env.AI_GROQ_TPM_LIMITS || '{}') || {}; } catch (_) { overrides = {}; }
  const limit = Number(overrides[model] ?? GROQ_TPM_DEFAULT_LIMITS[model]);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

/** Konserwatywne oszacowanie tokenów żądania: znaki promptu / 3 + max_completion_tokens. */
function estimateGroqRequestTokens(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const chars = messages.reduce((sum, message) => {
    const content = message?.content;
    if (typeof content === 'string') return sum + content.length;
    if (Array.isArray(content)) {
      return sum + content.reduce((inner, part) => inner + String(typeof part === 'string' ? part : (part?.text || '')).length, 0);
    }
    return sum;
  }, 0);
  const completion = Number(payload?.max_completion_tokens ?? payload?.max_tokens) || 0;
  return Math.ceil(chars / 3) + completion;
}

function activeGroqTpmEvents(model, now) {
  const events = (groqTpmEvents.get(model) || []).filter(event => (
    now - event.at < (event.pending ? GROQ_TPM_WINDOW_MS * 2 : GROQ_TPM_WINDOW_MS)
  ));
  groqTpmEvents.set(model, events);
  return events;
}

/**
 * Ile ms trzeba odczekać, aby żądanie o danym rozmiarze zmieściło się w limicie TPM modelu.
 * 0 = zmieści się teraz albo model nie ma lokalnego limitu.
 */
function groqTpmRetryAfterMs(model, estimatedTokens, now = Date.now()) {
  const limit = groqTpmLimitFor(String(model || ''));
  if (!limit) return 0;
  const budget = limit * GROQ_TPM_SAFETY;
  const estimate = Number(estimatedTokens) > 0 ? Number(estimatedTokens) : GROQ_TPM_DEFAULT_ESTIMATE;
  // Pojedyncze żądanie większe niż limit i tak nie przejdzie; niech zdecyduje API.
  if (estimate > budget) return 0;
  const events = activeGroqTpmEvents(String(model), now);
  let used = events.reduce((sum, event) => sum + event.tokens, 0);
  if (used + estimate <= budget) return 0;
  const byAge = [...events].sort((a, b) => a.at - b.at);
  for (const event of byAge) {
    used -= event.tokens;
    if (used + estimate <= budget) return Math.max(0, event.at + GROQ_TPM_WINDOW_MS - now);
  }
  return GROQ_TPM_WINDOW_MS;
}

function resetGroqTpmWindow() {
  groqTpmEvents.clear();
}

function trackGroqRequest(payload, result) {
  const model = String(payload?.model || '');
  if (!groqTpmLimitFor(model)) return;
  const entry = { at: Date.now(), tokens: estimateGroqRequestTokens(payload), pending: true };
  const events = groqTpmEvents.get(model) || [];
  events.push(entry);
  groqTpmEvents.set(model, events);
  const settleOk = (data) => {
    entry.pending = false;
    const used = Number(data?.usage?.total_tokens);
    if (Number.isFinite(used) && used > 0) entry.tokens = used;
  };
  const settleError = (error) => {
    entry.pending = false;
    const status = Number(error?.status ?? error?.statusCode ?? 0);
    // Odrzucone żądanie (429/400/401/403) nie zużywa tokenów; timeout/abort może już je zużyć.
    if ([400, 401, 403, 429].includes(status)) entry.tokens = 0;
  };
  if (result && typeof result.then === 'function') result.then(settleOk, settleError);
  else settleOk(result);
}

/**
 * Normalizuje bazowy URL dla oficjalnego groq-sdk.
 * Surowe fetch musi osobno dodać /openai/v1/chat/completions.
 */
function normalizujGroqBaseUrl(value) {
  return String(value || 'https://api.groq.com')
    .replace(/\/+$/, '')
    .replace(/\/openai\/v1$/i, '')
    .replace(/\/+$/, '');
}
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
  // The request budget and fallback chain own retries. SDK-level retries would
  // make one reserved model-call slot issue multiple hidden HTTP requests.
  const requestOptions = { maxRetries: 0, ...(signal ? { signal } : {}) };
  const result = groqClient.chat.completions.create(payload, requestOptions);
  // Zwracamy oryginalny wynik (tożsamość obiektu/promise bez zmian); licznik TPM
  // dopina się obok i nigdy nie zmienia ani nie połyka błędu wołającego.
  try { trackGroqRequest(payload, result); } catch (_) { /* licznik jest best-effort */ }
  return result;
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

module.exports = {
  createGroqCompletion,
  awaitWithAbortTimeout,
  withReasoningHeadroom,
  computeValidatorTimeout,
  computeValidatorReserveMs,
  computeGenerationTimeout,
  normalizujGroqBaseUrl,
  estimateGroqRequestTokens,
  groqTpmRetryAfterMs,
  resetGroqTpmWindow,
};
