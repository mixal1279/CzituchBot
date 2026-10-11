'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGroqCompletion, computeValidatorTimeout, computeGenerationTimeout } = require('../ai/provider-runtime');
const { classifyFailure, shouldRetryFailure, nextFallbacks, selectRepairFallbacks, repairBudgetBlockReason } = require('../ai/fallback');

test('Groq request uses a clean payload and no unsupported transport options', async () => {
  let observedPayload;
  let argumentCount = 0;
  const groqClient = {
    chat: { completions: { create(...args) {
      argumentCount = args.length;
      observedPayload = args[0];
      return Promise.resolve({ choices: [{ message: { content: 'ok' } }] });
    } } },
  };
  const payload = {
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'test' }],
    max_completion_tokens: 300,
    reasoning_effort: 'low',
    include_reasoning: false,
    temperature: 0.2,
  };
  const response = await createGroqCompletion(groqClient, payload, { timeoutMs: 100 });
  assert.equal(response.choices[0].message.content, 'ok');
  assert.equal(observedPayload, payload);
  assert.equal(Object.hasOwn(observedPayload, 'signal'), false);
  assert.equal(argumentCount, 1, 'the SDK must receive only the JSON request payload');
});

test('Groq wrapper timeout rejects and lets the fallback chain continue', async () => {
  const groqClient = {
    chat: { completions: { create() { return new Promise(() => {}); } } },
  };
  await assert.rejects(
    createGroqCompletion(groqClient, { model: 'openai/gpt-oss-120b' }, { timeoutMs: 5 }),
    error => error.code === 'ETIMEDOUT' && /timed out/.test(error.message),
  );
});

test('validator timeout is capped and reserves time for fallback', () => {
  assert.equal(computeValidatorTimeout(23309), 9000);
  assert.equal(computeValidatorTimeout(21830), 9000);
  assert.equal(computeValidatorTimeout(15000), 8500);
  assert.equal(computeValidatorTimeout(12983), 6483);
  assert.equal(computeValidatorTimeout(12410), 5910);
  assert.equal(computeValidatorTimeout(10500), 4000);
  assert.equal(computeValidatorTimeout(10499), null);
  assert.equal(computeValidatorTimeout(0), null);
});

test('generation timeout skips calls that cannot run for long enough while preserving fallback reserve', () => {
  assert.equal(computeGenerationTimeout(25000), 9000);
  assert.equal(computeGenerationTimeout(16000), 9000);
  assert.equal(computeGenerationTimeout(10000), 5500);
  assert.equal(computeGenerationTimeout(8500), 4000);
  assert.equal(computeGenerationTimeout(8499), null);
  assert.equal(computeGenerationTimeout(4499), null);
  assert.equal(computeGenerationTimeout(Number.NaN), null);
});

test('provider and validator failures receive distinct categories', () => {
  const cases = [
    ['network transport error: fetch failed', 'transport_error'],
    ['xKiro validator TRANSPORT_ERROR', 'transport_error'],
    ['This operation was aborted', 'timeout_abort'],
    ['OpenRouter empty content', 'empty_response'],
    ['finish_reason":"length","has_reasoning":false', 'empty_response'],
    ['OpenRouter returned invalid JSON', 'invalid_json'],
    ['validator JSON schema contract rejected', 'schema_rejection'],
    ['validator rejected unsupported claims', 'validator_rejection'],
    ['provider unavailable: OpenRouter', 'provider_unavailable'],
    ['Gemini generation cooldown', 'provider_cooldown'],
    ['AI request budget exceeded', 'budget_exhausted'],
  ];
  for (const [message, expected] of cases) assert.equal(classifyFailure(message), expected, message);
  assert.equal(classifyFailure({ status: 'rejected', reason: 'unsupported claims' }), 'validator_rejection');
  assert.equal(classifyFailure({ status: 'rejected', reason: 'invalid JSON schema from validator' }), 'schema_rejection');
  assert.equal(classifyFailure({ status: 'accepted', reason: 'grounded' }), null);
  assert.equal(classifyFailure({ status: 'inconclusive', reason: 'insufficient evidence' }), 'validator_inconclusive');
  assert.equal(classifyFailure({ status: 'unavailable', reason: 'fallback validator niedostępny' }), 'provider_unavailable');
  assert.equal(classifyFailure({ status: 'unavailable', reason: 'xKiro validator niedostępny', error: 'This operation was aborted' }), 'timeout_abort');
  assert.equal(classifyFailure('Groq chat.completions.create is unavailable; extra.requestContract={"endpoint":"chat.completions.create"}'), 'provider_unavailable');
  assert.equal(shouldRetryFailure('timeout_abort'), true);
  assert.equal(shouldRetryFailure('validator_rejection'), false, 'semantic rejection must not be treated as transport failure');
});

test('fallback selection excludes failed and repeated providers', () => {
  const selected = nextFallbacks({
    failure: 'validator_rejection',
    attempted: ['groq:openai/gpt-oss-120b'],
    failedProviders: ['xkiro:default', 'openrouter:default'],
    maxFallbacks: 10,
  });
  assert.ok(!selected.includes('groq:openai/gpt-oss-120b'));
  assert.ok(!selected.includes('xkiro:default'));
  assert.ok(!selected.includes('openrouter:default'));
});

test('repair after validator rejection selects only configured healthy providers and terminates deterministically otherwise', () => {
  const failedProviders = [
    'groq:openai/gpt-oss-120b',
    'groq:openai/gpt-oss-20b',
    'gemini:gemini-3.8-flash',
    'gemini:gemini-3.5-flash-lite',
    'xkiro:default',
  ];
  assert.deepEqual(selectRepairFallbacks({
    failedProviders,
    availableProviders: ['openrouter:default'],
    maxFallbacks: 1,
  }), ['openrouter:default']);
  assert.deepEqual(selectRepairFallbacks({
    failedProviders,
    availableProviders: [],
    maxFallbacks: 1,
  }), []);
});

test('repair checks shared model-call and generation limits before selecting a provider', () => {
  const budget = {
    remainingMs: 5000,
    generations: 5,
    maxGenerations: 6,
    repairGenerations: 0,
    maxRepairGenerations: 1,
    modelCalls: 8,
    maxModelCalls: 8,
  };
  assert.equal(repairBudgetBlockReason(budget), 'model_calls_exhausted');
  assert.equal(repairBudgetBlockReason({ ...budget, modelCalls: 7 }), null);
  assert.equal(repairBudgetBlockReason({ ...budget, modelCalls: 7, remainingMs: 0 }), 'request_deadline_exhausted');
});
