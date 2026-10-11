'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIRequestContext } = require('../ai/requestContext');

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


test('request context can reserve generation slots for semantic repair', () => {
  const ctx = createAIRequestContext({
    requestId: 'repair-reserve',
    maxCzasMs: 60000,
    maxGeneracji: 8,
    maxInitialGeneracji: 4,
    maxRepairGeneracji: 4,
    maxModelCalls: 14,
  });

  for (let i = 0; i < 4; i++) {
    assert.equal(ctx.reserveGeneration('groq', `initial-${i}`, 'initial'), true);
  }
  assert.equal(ctx.reserveGeneration('groq', 'initial-overflow', 'initial'), false);
  assert.equal(ctx.repairGeneracje, 0);

  for (let i = 0; i < 4; i++) {
    assert.equal(ctx.reserveGeneration('gemini', `repair-${i}`, 'repair'), true);
  }
  assert.equal(ctx.reserveGeneration('xkiro', 'repair-overflow', 'repair'), false);
  assert.equal(ctx.generacje, 8);
  assert.equal(ctx.initialGeneracje, 4);
  assert.equal(ctx.repairGeneracje, 4);
  assert.equal(ctx.modelCalls, 8);
});
