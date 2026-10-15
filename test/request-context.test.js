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


test('request context default timeout matches the shared AI limit configuration', () => {
  const ctx = createAIRequestContext();
  assert.equal(ctx.maxCzasMs, DEFAULTS.requestTimeoutMs);
});

test('shared AI request timeout is 40 seconds to leave room for repair and fallback', () => {
  assert.equal(DEFAULTS.requestTimeoutMs, 40000);
});

test('production pipeline reads its timeout from shared AI limits', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');
  assert.match(source, /maxCzasMs:\s*DEFAULTS\.requestTimeoutMs/);
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
  assert.match(source, /maxValidatorow:\\s*DEFAULTS\\.maxValidators/);
});
