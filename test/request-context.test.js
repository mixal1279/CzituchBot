'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIRequestContext } = require('../ai/requestContext');
const { DEFAULTS } = require('../ai/limits');

test('request context enforces shared model, generation, validator and Tavily budgets', () => {
  const ctx = createAIRequestContext({
    requestId: 'test',
    maxCzasMs: 60000,
    maxGeneracji: 2,
    maxModelCalls: 3,
    maxValidatorow: 1,
    maxWyszukanTavily: 1,
  });

  assert.equal(ctx.reserveGeneration('groq', 'model-a'), true);
  assert.equal(ctx.generacje, 1);
  assert.equal(ctx.modelCalls, 1);

  assert.equal(ctx.reserveGeneration('groq', 'model-b'), true);
  assert.equal(ctx.generacje, 2);
  assert.equal(ctx.modelCalls, 2);

  assert.equal(ctx.reserveGeneration('gemini', 'model-c'), false);
  assert.equal(ctx.generacje, 2);
  assert.equal(ctx.modelCalls, 2);

  assert.equal(ctx.reserveModel('validator:gemini'), true);
  assert.equal(ctx.modelCalls, 3);
  assert.equal(ctx.reserveModel('over-budget'), false);

  assert.equal(ctx.reserveValidator('validator'), true);
  assert.equal(ctx.reserveValidator('validator-again'), false);

  assert.equal(ctx.reserveTavily('retrieval'), true);
  assert.equal(ctx.reserveTavily('retrieval-again'), false);
});

test('generation budget preflight is non-mutating and accounts for model-call capacity', () => {
  const ctx = createAIRequestContext({ maxGeneracji: 2, maxModelCalls: 1 });
  assert.equal(ctx.canReserveGeneration('initial'), true);
  assert.equal(ctx.generacje, 0);
  assert.equal(ctx.modelCalls, 0);
  assert.equal(ctx.reserveGeneration('groq', 'model'), true);
  assert.equal(ctx.canReserveGeneration('initial'), false);
  assert.equal(ctx.generacje, 1);
  assert.equal(ctx.modelCalls, 1);
});

test('request context clamps remaining time to zero instead of extending the deadline', () => {
  const ctx = createAIRequestContext({ startedAt: Date.now() - 1000, maxCzasMs: 100 });
  assert.equal(ctx.isExpired(), true);
  assert.equal(ctx.remainingMs(), 0);
  assert.equal(ctx.reserveModel('late-call'), false);
});

test('request context snapshot is stable and exposes one shared budget', () => {
  const ctx = createAIRequestContext({
    requestId: 'snapshot-test',
    maxCzasMs: 5000,
    maxGeneracji: 4,
    maxModelCalls: 5,
    maxValidatorow: 2,
    maxWyszukanTavily: 2,
  });
  ctx.reserveGeneration('groq', 'model');
  ctx.reserveValidator('validator');
  ctx.reserveTavily('retrieval');

  const snapshot = ctx.snapshot();
  assert.equal(snapshot.requestId, 'snapshot-test');
  assert.equal(snapshot.generacje, 1);
  assert.equal(snapshot.modelCalls, 1);
  assert.equal(snapshot.validatory, 1);
  assert.equal(snapshot.tavilySearches, 1);
  assert.ok(snapshot.remainingMs >= 0);
  assert.ok(snapshot.remainingMs <= snapshot.maxCzasMs);
});


test('request context defaults match the shared AI limit configuration', () => {
  const ctx = createAIRequestContext();
  assert.equal(ctx.maxCzasMs, DEFAULTS.requestTimeoutMs);
  assert.equal(ctx.maxGeneracji, DEFAULTS.maxGenerations);
  assert.equal(ctx.maxInitialGeneracji, DEFAULTS.maxInitialGenerations);
  assert.equal(ctx.maxRepairGeneracji, DEFAULTS.maxRepairGenerations);
  assert.equal(ctx.maxModelCalls, DEFAULTS.maxModelCalls);
  assert.equal(ctx.maxValidatorow, DEFAULTS.maxValidators);
  assert.equal(ctx.maxWyszukanTavily, DEFAULTS.maxTavilySearches);
});

test('request context phase generation limits cannot exceed the total generation budget', () => {
  const ctx = createAIRequestContext({ maxGeneracji: 2, maxInitialGeneracji: 5, maxRepairGeneracji: 4 });
  assert.equal(ctx.maxGeneracji, 2);
  assert.equal(ctx.maxInitialGeneracji, 2);
  assert.equal(ctx.maxRepairGeneracji, 2);
});

test('shared AI request timeout is 40 seconds to leave room for repair and fallback', () => {
  assert.equal(DEFAULTS.requestTimeoutMs, 40000);
});

test('production pipeline reads its timeout from shared AI limits', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');
  assert.match(source, /maxCzasMs:\s*DEFAULTS\.requestTimeoutMs/);
  assert.match(source, /maxGeneracji:\s*DEFAULTS\.maxGenerations/);
  assert.match(source, /maxInitialGeneracji:\s*DEFAULTS\.maxInitialGenerations/);
  assert.match(source, /maxRepairGeneracji:\s*DEFAULTS\.maxRepairGenerations/);
  assert.match(source, /maxModelCalls:\s*DEFAULTS\.maxModelCalls/);
  assert.doesNotMatch(source, /maxCzasMs:\s*25000/);
});

test('request context snapshot declares initial and repair generation counters once', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'ai', 'requestContext.js'), 'utf8');
  const snapshotBody = source.match(/ctx\.snapshot\s*=\s*\(\)\s*=>\s*\(\{([\s\S]*?)\n  \}\);/)?.[1];
  assert.ok(snapshotBody, 'snapshot body should be present');
  assert.equal((snapshotBody.match(/\binitialGeneracje\s*:/g) || []).length, 1);
  assert.equal((snapshotBody.match(/\brepairGeneracje\s*:/g) || []).length, 1);
});

test('request context reserves all shared validator slots, including the final OpenRouter fallback', () => {
  const ctx = createAIRequestContext();
  assert.equal(ctx.maxValidatorow, DEFAULTS.maxValidators);
  assert.equal(DEFAULTS.maxValidators, 4);
  assert.equal(ctx.reserveValidator('gemini:first'), true);
  assert.equal(ctx.reserveValidator('gemini:repair'), true);
  assert.equal(ctx.reserveValidator('xkiro'), true);
  assert.equal(ctx.reserveValidator('openrouter'), true);
  assert.equal(ctx.reserveValidator('over-budget'), false);
});

test('production pipeline uses shared validator limit', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');
  assert.match(source, /maxValidatorow:\s*DEFAULTS\.maxValidators/);
});


test('validator and model-call slots are reserved atomically', () => {
  const blocked = createAIRequestContext({ maxValidatorow: 1, maxModelCalls: 0 });
  assert.equal(blocked.reserveValidatorModel('validator:blocked'), false);
  assert.equal(blocked.validatory, 0);
  assert.equal(blocked.modelCalls, 0);

  const allowed = createAIRequestContext({ maxValidatorow: 1, maxModelCalls: 1 });
  assert.equal(allowed.reserveValidatorModel('validator:allowed'), true);
  assert.equal(allowed.validatory, 1);
  assert.equal(allowed.modelCalls, 1);
  assert.equal(allowed.reserveValidatorModel('validator:over-budget'), false);
  assert.equal(allowed.validatory, 1);
  assert.equal(allowed.modelCalls, 1);
});

test('repair generation is not reserved below the 8.5 second time floor', () => {
  const ctx = createAIRequestContext({
    startedAt: Date.now() - 2000,
    maxCzasMs: 10000,
    maxGeneracji: 4,
    maxInitialGeneracji: 3,
    maxRepairGeneracji: 1,
    maxModelCalls: 6,
  });
  assert.ok(ctx.remainingMs() < 8500);
  assert.equal(ctx.reserveGeneration('gemini', 'repair-model', 'repair'), false);
  assert.equal(ctx.repairGeneracje, 0);
  assert.equal(ctx.modelCalls, 0);
});

test('repair preflight matches the minimum generation timeout and fallback reserve', () => {
  const insufficient = createAIRequestContext({ startedAt: Date.now(), maxCzasMs: 13000 });
  assert.equal(insufficient.canReserveGeneration('repair'), false);
  assert.equal(insufficient.repairGeneracje, 0);
  const sufficient = createAIRequestContext({ startedAt: Date.now(), maxCzasMs: 14000 });
  assert.equal(sufficient.canReserveGeneration('repair'), true);
  assert.equal(sufficient.repairGeneracje, 0);
});
