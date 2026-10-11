'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGroqCompletion, computeValidatorTimeout, computeGenerationTimeout } = require('../ai/provider-runtime');
const { classifyFailure, shouldRetryFailure, nextFallbacks, selectRepairFallbacks, repairBudgetBlockReason, resetProviderQuotaCooldowns, markProviderQuota, isProviderQuotaBlocked, quotaCooldownMsFromError } = require('../ai/fallback');

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

test('quota circuit blocks sibling models at the same provider and expires', () => {
  resetProviderQuotaCooldowns();
  const blocked = markProviderQuota('groq:openai/gpt-oss-120b', 10_000);
  assert.deepEqual(blocked, ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b']);
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), true);
  const next = nextFallbacks({ maxFallbacks: 10 });
  assert.ok(!next.some(provider => provider.startsWith('groq:')));
  assert.ok(next.includes('gemini:gemini-3.8-flash'));
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-20b', Date.now() + 11_000), false);
  resetProviderQuotaCooldowns();
});

test('quota cooldown respects Retry-After and never goes below the configured backoff', () => {
  const previous = process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS;
  process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS = '5000';
  try {
    assert.equal(quotaCooldownMsFromError('HTTP 429 (Retry-After=12s)'), 12_000);
    assert.equal(quotaCooldownMsFromError('HTTP 429 rate limit'), 5_000);
  } finally {
    if (previous === undefined) delete process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS;
    else process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS = previous;
  }
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
