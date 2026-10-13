'use strict';

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
  const ctx = {
    requestId: String(options.requestId || '-'),
    startedAt: Number.isFinite(options.startedAt) ? options.startedAt : Date.now(),
    maxCzasMs: clampLimit(options.maxCzasMs, 60000),
    maxGeneracji: clampLimit(options.maxGeneracji, 6),
    maxInitialGeneracji: clampLimit(options.maxInitialGeneracji, clampLimit(options.maxGeneracji, 6)),
    maxRepairGeneracji: clampLimit(options.maxRepairGeneracji, 0),
    maxModelCalls: clampLimit(options.maxModelCalls, 12),
    maxValidatorow: clampLimit(options.maxValidatorow, 2),
    maxWyszukanTavily: clampLimit(options.maxWyszukanTavily, 3),

    generacje: 0,
    initialGeneracje: 0,
    repairGeneracje: 0,
    modelCalls: 0,
    validatory: 0,
    tavilySearches: 0,
    validatorResults: [],
    generationAttempts: [],
    generationPhase: 'initial',
    fallbackReasons: [],
    finalStatus: 'unavailable',
  };

  ctx.elapsedMs = () => Math.max(0, Date.now() - ctx.startedAt);
  ctx.remainingMs = () => Math.max(0, ctx.maxCzasMs - ctx.elapsedMs());
  ctx.isExpired = () => ctx.remainingMs() <= 0;

  ctx.reserve = (counter, limit, purpose = counter) => {
    if (ctx.isExpired() || ctx[counter] >= limit) return false;
    ctx[counter]++;
    return true;
  };

  ctx.reserveModel = (purpose = 'model') =>
    ctx.reserve('modelCalls', ctx.maxModelCalls, purpose);

  ctx.reserveGeneration = (provider, model, phase = 'initial') => {
    if (ctx.isExpired() || ctx.generacje >= ctx.maxGeneracji) return false;
    const isRepair = phase === 'repair';
    // A repair attempt needs enough time for the generation timeout policy
    // (4s minimum generation window + 4.5s reserved for validation/fallback).
    // Keep this guard here as a final safety net for callers that bypass preflight.
    if (isRepair && ctx.remainingMs() < 8500) return false;
    if (isRepair && ctx.repairGeneracje >= ctx.maxRepairGeneracji) return false;
    if (!isRepair && ctx.initialGeneracje >= ctx.maxInitialGeneracji) return false;
    if (!ctx.reserveModel(`generation:${phase}:${provider}/${model}`)) return false;
    ctx.generacje++;
    if (isRepair) ctx.repairGeneracje++;
    else ctx.initialGeneracje++;
    return true;
  };

  ctx.reserveValidator = (purpose = 'validator') =>
    ctx.reserve('validatory', ctx.maxValidatorow, purpose);

  // Reserve validator and model budgets atomically: a failed model-budget check
  // must not consume a validator slot (and vice versa).
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
    initialGeneracje: ctx.initialGeneracje,
    repairGeneracje: ctx.repairGeneracje,
    generationPhase: ctx.generationPhase,
    generationAttempts: [...ctx.generationAttempts],
    modelCalls: ctx.modelCalls,
    validatory: ctx.validatory,
    tavilySearches: ctx.tavilySearches,
    fallbackReasons: [...ctx.fallbackReasons],
    finalStatus: ctx.finalStatus,
  });

  return ctx;
}

module.exports = { createAIRequestContext };
