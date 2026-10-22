'use strict';

const { DEFAULTS } = require('./limits');

/**
 * Wspólny budżet pojedynczego żądania AI.
 *
 * Zasada: wszystkie etapy pipeline'u korzystają z jednego kontekstu.
 * Rezerwacja jest atomowa względem synchronicznego kodu JS: licznik rośnie
 * tylko wtedy, gdy operacja rzeczywiście dostała slot.
 */
function clampLimit(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function createAIRequestContext(options = {}) {
  const maxGeneracji = clampLimit(options.maxGeneracji, DEFAULTS.maxGenerations);
  // An explicit total override retains the historical behavior of allowing all
  // of that total for initial generations unless the caller sets a phase cap.
  const defaultInitialGeneracji = options.maxGeneracji === undefined
    ? DEFAULTS.maxInitialGenerations
    : maxGeneracji;
  const ctx = {
    requestId: String(options.requestId || '-'),
    startedAt: Number.isFinite(options.startedAt) ? options.startedAt : Date.now(),
    maxCzasMs: clampLimit(options.maxCzasMs, DEFAULTS.requestTimeoutMs),
    maxGeneracji,
    maxInitialGeneracji: Math.min(
      clampLimit(options.maxInitialGeneracji, defaultInitialGeneracji),
      maxGeneracji,
    ),
    maxRepairGeneracji: Math.min(
      clampLimit(options.maxRepairGeneracji, DEFAULTS.maxRepairGenerations),
      maxGeneracji,
    ),
    maxModelCalls: clampLimit(options.maxModelCalls, DEFAULTS.maxModelCalls),
    maxValidatorow: clampLimit(options.maxValidatorow, DEFAULTS.maxValidators),
    maxWyszukanTavily: clampLimit(options.maxWyszukanTavily, DEFAULTS.maxTavilySearches),

    generacje: 0,
    initialGeneracje: 0,
    repairGeneracje: 0,
    modelCalls: 0,
    validatory: 0,
    tavilySearches: 0,
    validatorResults: [],
    generationAttempts: [],
    timingTrace: [],
    generationPhase: 'initial',
    fallbackReasons: [],
    finalStatus: 'unavailable',
  };

  ctx.elapsedMs = () => Math.max(0, Date.now() - ctx.startedAt);
  ctx.remainingMs = () => Math.max(0, ctx.maxCzasMs - ctx.elapsedMs());
  ctx.isExpired = () => ctx.remainingMs() <= 0;

  // Diagnostic-only timeline: records the shared deadline and counters at phase boundaries.
  // Keep the trace bounded and store only explicitly supplied, JSON-safe metadata.
  ctx.recordTiming = (stage, details = {}) => {
    const event = {
      stage: String(stage || 'unknown').slice(0, 80),
      elapsedMs: ctx.elapsedMs(),
      remainingMs: ctx.remainingMs(),
      generationPhase: ctx.generationPhase,
      generations: ctx.generacje,
      initialGenerations: ctx.initialGeneracje,
      repairGenerations: ctx.repairGeneracje,
      modelCalls: ctx.modelCalls,
      validators: ctx.validatory,
      tavilySearches: ctx.tavilySearches,
      ...details,
    };
    ctx.timingTrace.push(event);
    if (ctx.timingTrace.length > 100) ctx.timingTrace.shift();
    return event;
  };

  ctx.reserve = (counter, limit, purpose = counter) => {
    if (ctx.isExpired() || ctx[counter] >= limit) return false;
    ctx[counter]++;
    return true;
  };

  ctx.reserveModel = (purpose = 'model') =>
    ctx.reserve('modelCalls', ctx.maxModelCalls, purpose);

  ctx.canReserveGeneration = (phase = 'initial') => {
    if (ctx.isExpired() || ctx.generacje >= ctx.maxGeneracji || ctx.modelCalls >= ctx.maxModelCalls) return false;
    const isRepair = phase === 'repair';

    // Repair generation has a 4.5s cap, a 10.5s validation/fallback reserve,
    // and a 3s minimum request. Do not advertise a slot that cannot run.
    if (isRepair && ctx.remainingMs() < 13500) return false;
    if (isRepair && ctx.repairGeneracje >= ctx.maxRepairGeneracji) return false;
    if (!isRepair && ctx.initialGeneracje >= ctx.maxInitialGeneracji) return false;
    return true;
  };

  ctx.reserveGeneration = (provider, model, phase = 'initial') => {
    if (!ctx.canReserveGeneration(phase)) return false;
    const isRepair = phase === 'repair';
    if (!ctx.reserveModel(`generation:${phase}:${provider}/${model}`)) return false;
    ctx.generacje++;
    if (isRepair) ctx.repairGeneracje++;
    else ctx.initialGeneracje++;
    return true;
  };

  ctx.reserveValidator = (purpose = 'validator') =>
    ctx.reserve('validatory', ctx.maxValidatorow, purpose);


  ctx.reserveValidatorModel = (purpose = 'validator') => {
    if (ctx.isExpired()
      || ctx.validatory >= ctx.maxValidatorow
      || ctx.modelCalls >= ctx.maxModelCalls) return false;
    ctx.validatory++;
    ctx.modelCalls++;
    return true;
  };

  ctx.reserveTavily = (purpose = 'tavily') =>
    ctx.reserve('tavilySearches', ctx.maxWyszukanTavily, purpose);

  ctx.snapshot = () => ({
    requestId: ctx.requestId,
    startedAt: ctx.startedAt,
    elapsedMs: ctx.elapsedMs(),
    remainingMs: ctx.remainingMs(),
    maxCzasMs: ctx.maxCzasMs,
    maxGeneracji: ctx.maxGeneracji,
    maxInitialGeneracji: ctx.maxInitialGeneracji,
    maxRepairGeneracji: ctx.maxRepairGeneracji,
    initialGeneracje: ctx.initialGeneracje,
    repairGeneracje: ctx.repairGeneracje,
    maxModelCalls: ctx.maxModelCalls,
    maxValidatorow: ctx.maxValidatorow,
    maxWyszukanTavily: ctx.maxWyszukanTavily,
    generacje: ctx.generacje,
    generationPhase: ctx.generationPhase,
    generationAttempts: [...ctx.generationAttempts],
    timingTrace: ctx.timingTrace.map(event => ({ ...event })),
    modelCalls: ctx.modelCalls,
    validatory: ctx.validatory,
    tavilySearches: ctx.tavilySearches,
    fallbackReasons: [...ctx.fallbackReasons],
    finalStatus: ctx.finalStatus,
  });

  return ctx;
}

module.exports = { createAIRequestContext };
