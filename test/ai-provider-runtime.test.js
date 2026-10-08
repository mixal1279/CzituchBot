'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGroqCompletion, computeValidatorTimeout } = require('../ai/provider-runtime');
const { classifyFailure, shouldRetryFailure, nextFallbacks, selectRepairFallbacks, repairBudgetBlockReason } = require('../ai/fallback');

test('Groq request body never contains signal; AbortSignal is passed in SDK transport options', async () => {
  const controller = new AbortController();
  let observedPayload;
  let observedOptions;
  let timedOut = false;
  const groqClient = {
    chat: { completions: { create(payload, options) {
      observedPayload = payload;
      observedOptions = options;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          timedOut = true;
          reject(Object.assign(new Error('request aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    } } },
  };
  const payload = {
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'test' }],
    max_completion_tokens: 300,
    reasoning_effort: 'medium',
    include_reasoning: false,
    temperature: 0.2,
  };
  const pending = createGroqCompletion(groqClient, payload, { signal: controller.signal });
  assert.equal(observedPayload, payload);
  assert.equal(Object.hasOwn(observedPayload, 'signal'), false);
  assert.equal(observedOptions.signal, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(timedOut, true, 'aborting the request must still cancel the in-flight SDK request');
});

test('validator timeout is capped by remaining budget and keeps a reserve for fallback', () => {
  assert.equal(computeValidatorTimeout(12000), 6000);
  assert.equal(computeValidatorTimeout(7500), 6000);
  assert.equal(computeValidatorTimeout(5000), 3500);
  assert.equal(computeValidatorTimeout(2999), null);
  assert.equal(computeValidatorTimeout(0), null);
});

test('provider and validator failures receive distinct categories', () => {
  const cases = [
    ['network transport error: fetch failed', 'transport_error'],
    ['xKiro validator TRANSPORT_ERROR', 'transport_error'],
    ['This operation was aborted', 'timeout_abort'],
    ['OpenRouter empty content', 'empty_response'],
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
