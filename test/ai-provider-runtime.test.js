'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGroqCompletion, awaitWithAbortTimeout, computeValidatorTimeout, computeValidatorReserveMs, computeGenerationTimeout } = require('../ai/provider-runtime');
const { classifyFailure, shouldRetryFailure, nextFallbacks, selectRepairFallbacks, filterAvailableFallbacks, repairBudgetBlockReason, resetProviderQuotaCooldowns, markProviderQuota, isProviderQuotaBlocked, quotaCooldownMsFromError, retryAfterHint, configuredMaxFallbackSteps, shouldOpenQuotaCircuit } = require('../ai/fallback');

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
  assert.equal(observedOptions.maxRetries, 0, 'fallback orchestration must own retries; no hidden SDK retries');
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(timedOut, true, 'aborting the request must still cancel the in-flight SDK request');
});

test('hard timeout releases the pipeline when a provider ignores AbortSignal', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const neverSettles = new Promise(() => {});
  await assert.rejects(
    awaitWithAbortTimeout(neverSettles, 15, controller, 'test provider'),
    error => error.name === 'TimeoutError' && /timed out after 15ms/.test(error.message),
  );
  assert.equal(controller.signal.aborted, true);
  assert.ok(Date.now() - startedAt < 250, 'pipeline should not wait for the provider’s own timeout');
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

test('xKiro timeout policy preserves enough time for the OpenRouter validator fallback', () => {
  const options = { maxTimeoutMs: 9000, reserveMs: 10500, minTimeoutMs: 4000 };
  assert.equal(computeValidatorTimeout(12306, options), null, 'skip xKiro rather than consume the OpenRouter reserve');
  assert.equal(computeValidatorTimeout(16000, options), 5500, 'cap xKiro so at least 10.5 seconds remain');
  assert.equal(computeValidatorTimeout(20000, options), 9000);
});

test('generation timeout skips calls that cannot run for long enough while preserving fallback reserve', () => {
  assert.equal(computeGenerationTimeout(25000), 12000);
  assert.equal(computeGenerationTimeout(16000), 9500);
  assert.equal(computeGenerationTimeout(12000), 5500);
  assert.equal(computeGenerationTimeout(10500), 4000);
  assert.equal(computeGenerationTimeout(10499), null);
  assert.equal(computeGenerationTimeout(4499), null);
  assert.equal(computeGenerationTimeout(Number.NaN), null);
});

test('repair generation is capped to 4.5s and reserves 10.5s for final validation', () => {
  const repairOptions = { maxTimeoutMs: 4500, reserveMs: 10500, minTimeoutMs: 3000 };
  assert.equal(computeGenerationTimeout(20000, repairOptions), 4500);
  assert.equal(computeGenerationTimeout(15000, repairOptions), 4500);
  assert.equal(computeGenerationTimeout(14000, repairOptions), 3500);
  assert.equal(computeGenerationTimeout(13500, repairOptions), 3000);
  assert.equal(computeGenerationTimeout(13499, repairOptions), null);
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
    ['120B global circuit breaker/request quota', 'budget_exhausted'],
  ];
  for (const [message, expected] of cases) assert.equal(classifyFailure(message), expected, message);
  assert.equal(classifyFailure({ status: 'rejected', reason: 'unsupported claims' }), 'validator_rejection');
  assert.equal(classifyFailure({ status: 'rejected', reason: 'invalid JSON schema from validator' }), 'schema_rejection');
  assert.equal(classifyFailure({ status: 'accepted', reason: 'grounded' }), null);
  assert.equal(classifyFailure({ status: 'soft_accepted', reason: 'partial answer' }), 'validator_rejection');
  assert.equal(classifyFailure({ status: 'inconclusive', reason: 'insufficient evidence' }), 'validator_inconclusive');
  assert.equal(classifyFailure({ status: 'unavailable', reason: 'fallback validator niedostępny' }), 'provider_unavailable');
  assert.equal(classifyFailure({ status: 'unavailable', reason: 'xKiro validator niedostępny', error: 'This operation was aborted' }), 'timeout_abort');
  assert.equal(classifyFailure('Groq chat.completions.create is unavailable; extra.requestContract={"endpoint":"chat.completions.create"}'), 'provider_unavailable');
  assert.equal(shouldRetryFailure('timeout_abort'), true);
  assert.equal(shouldRetryFailure('validator_rejection'), false, 'semantic rejection must not be treated as transport failure');
});

test('configured fallback limit parses valid values and defaults safely', () => {
  assert.equal(configuredMaxFallbackSteps('2'), 2);
  assert.equal(configuredMaxFallbackSteps('0'), 0);
  assert.equal(configuredMaxFallbackSteps(''), 6);
  assert.equal(configuredMaxFallbackSteps('invalid'), 6);
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

test('quota circuit blocks only the exhausted endpoint and expires', () => {
  resetProviderQuotaCooldowns();
  const blocked = markProviderQuota('groq:openai/gpt-oss-120b', 10_000);
  assert.deepEqual(blocked, ['groq:openai/gpt-oss-120b']);
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-120b'), true);
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), false);
  const next = nextFallbacks({ maxFallbacks: 10 });
  assert.ok(!next.includes('groq:openai/gpt-oss-120b'));
  assert.ok(next.includes('groq:openai/gpt-oss-20b'));
  assert.ok(next.includes('gemini:gemini-3.8-flash'));
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-120b', Date.now() + 11_000), false);
  markProviderQuota('xkiro:default', 1_000);
  assert.equal(isProviderQuotaBlocked('xkiro:default', Date.now() + 1_500), false);
  resetProviderQuotaCooldowns();
});

test('quota cooldown supports configured models outside the default fallback chain', () => {
  resetProviderQuotaCooldowns();
  const customModel = 'groq:custom/generator-model:v1';
  assert.deepEqual(markProviderQuota(customModel, 10_000), [customModel]);
  assert.equal(isProviderQuotaBlocked(customModel), true);
  assert.deepEqual(markProviderQuota('unknown:model', 10_000), []);
  resetProviderQuotaCooldowns();
});

test('xKiro and OpenRouter generation aliases share cooldown with their configured model', () => {
  const previousXkiro = process.env.XKIRO_MODEL;
  const previousOpenRouterGenerator = process.env.OPENROUTER_GENERATOR_MODEL;
  const previousGenerator = process.env.AI_GENERATOR_MODEL;
  try {
    process.env.XKIRO_MODEL = 'custom/qwen:model';
    process.env.OPENROUTER_GENERATOR_MODEL = 'openai/custom-generator';
    process.env.AI_GENERATOR_MODEL = 'openai/other-primary';
    resetProviderQuotaCooldowns();
    markProviderQuota('xkiro:custom/qwen:model', 10_000);
    markProviderQuota('openrouter:openai/custom-generator', 10_000);
    assert.equal(isProviderQuotaBlocked('xkiro:default'), true);
    assert.equal(isProviderQuotaBlocked('openrouter:default'), true);
    assert.equal(isProviderQuotaBlocked('openrouter:openai/other-validator'), false);
  } finally {
    resetProviderQuotaCooldowns();
    if (previousXkiro === undefined) delete process.env.XKIRO_MODEL; else process.env.XKIRO_MODEL = previousXkiro;
    if (previousOpenRouterGenerator === undefined) delete process.env.OPENROUTER_GENERATOR_MODEL; else process.env.OPENROUTER_GENERATOR_MODEL = previousOpenRouterGenerator;
    if (previousGenerator === undefined) delete process.env.AI_GENERATOR_MODEL; else process.env.AI_GENERATOR_MODEL = previousGenerator;
  }
});

test('quota in one Gemini model leaves the sibling model available', () => {
  resetProviderQuotaCooldowns();
  markProviderQuota('gemini:gemini-3.8-flash', 10_000);
  assert.equal(isProviderQuotaBlocked('gemini:gemini-3.8-flash'), true);
  assert.equal(isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite'), false);
  const next = nextFallbacks({ maxFallbacks: 10 });
  assert.ok(!next.includes('gemini:gemini-3.8-flash'));
  assert.ok(next.includes('gemini:gemini-3.5-flash-lite'));
  resetProviderQuotaCooldowns();
});

test('Retry-After supports seconds and HTTP-date headers', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  assert.equal(retryAfterHint({ headers: new Headers({ 'retry-after': '12' }) }, now), 'Retry-After=12s');
  assert.equal(retryAfterHint({ headers: new Headers({ 'retry-after': 'Mon, 19 Oct 2026 12:00:20 GMT' }) }, now), 'Retry-After=20s');
  assert.equal(retryAfterHint({ headers: new Headers() }, now), '');
});

test('quota cooldown respects Retry-After and never goes below the configured backoff', () => {
  const previous = process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS;
  process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS = '5000';
  try {
    assert.equal(quotaCooldownMsFromError('HTTP 429 (Retry-After=12s)'), 12_000);
    assert.equal(quotaCooldownMsFromError('HTTP 429 rate limit'), 5_000);
    assert.equal(quotaCooldownMsFromError('HTTP 402 insufficient credits'), 24 * 60 * 60 * 1000);
    assert.equal(quotaCooldownMsFromError('HTTP 402 (Retry-After=30s)'), 24 * 60 * 60 * 1000);
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

test('repair checks shared model-call, generation and time limits before selecting a provider', () => {
  const budget = {
    // Naprawa wymaga co najmniej 13,5 s (3 s generowania + 10,5 s rezerwy).
    remainingMs: 20000,
    generations: 5,
    maxGenerations: 6,
    repairGenerations: 0,
    maxRepairGenerations: 1,
    modelCalls: 8,
    maxModelCalls: 8,
  };
  assert.equal(repairBudgetBlockReason(budget), 'model_calls_exhausted');
  assert.equal(repairBudgetBlockReason({ ...budget, modelCalls: 7 }), null);
  assert.equal(repairBudgetBlockReason({ ...budget, modelCalls: 7, remainingMs: 8499 }), 'insufficient_time_for_fallback');
  assert.equal(repairBudgetBlockReason({ ...budget, modelCalls: 7, remainingMs: 0 }), 'request_deadline_exhausted');
});

test('fallback filtering does not let unconfigured providers consume fallback slots', () => {
  const candidates = [
    'gemini:gemini-3.8-flash',
    'gemini:gemini-3.5-flash-lite',
    'xkiro:default',
    'openrouter:default',
  ];
  const configured = ['xkiro:default', 'openrouter:default'];
  assert.deepEqual(filterAvailableFallbacks(candidates, configured), ['xkiro:default', 'openrouter:default']);
  assert.deepEqual(filterAvailableFallbacks(candidates, ['openrouter:default']).slice(0, 1), ['openrouter:default']);
});


test('adaptive validator reserve follows the remaining slot count and deadline', () => {
  assert.equal(computeValidatorReserveMs(15000, 1, 4), 10500);
  assert.equal(computeValidatorReserveMs(12000, 1, 4), 6500);
  assert.equal(computeValidatorReserveMs(8000, 1, 4), 2500);
  assert.equal(computeValidatorReserveMs(12000, 3, 4), 6500);
  assert.equal(computeValidatorReserveMs(8000, 4, 4), 2500);
});

test('provider capacity pressure is transient rather than a quota cooldown', () => {
  assert.equal(classifyFailure('HTTP 429: high demand, temporarily unavailable'), 'transient');
  assert.equal(shouldOpenQuotaCircuit('HTTP 429: high demand, temporarily unavailable'), false);
  assert.equal(shouldOpenQuotaCircuit('HTTP 429: tokens per day limit exceeded'), true);
  assert.equal(quotaCooldownMsFromError('HTTP 429: high demand, temporarily unavailable'), 60000);
  assert.equal(classifyFailure('HTTP 429: tokens per day limit exceeded'), 'quota');
  assert.equal(classifyFailure('HTTP 402: Payment Required'), 'quota');
  assert.equal(shouldOpenQuotaCircuit('HTTP 402: Payment Required'), true);
  assert.equal(classifyFailure('HTTP 402: openrouter_in_flight_budget exhausted; Retry-After=30s'), 'quota');
  assert.equal(shouldOpenQuotaCircuit('HTTP 402: openrouter_in_flight_budget exhausted; Retry-After=30s'), false);
});

test('repair is skipped when less than the minimum generation plus fallback reserve remains', () => {
  const budget = {
    remainingMs: 13499,
    generations: 1,
    maxGenerations: 6,
    repairGenerations: 0,
    maxRepairGenerations: 1,
    modelCalls: 1,
    maxModelCalls: 12,
  };
  assert.equal(repairBudgetBlockReason(budget), 'insufficient_time_for_fallback');
  assert.equal(repairBudgetBlockReason({ ...budget, remainingMs: 13500 }), null);
});


test('Groq cooldown parser honors duration hints with or without seconds', () => {
  const previous = process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS;
  process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS = '5000';
  try {
    assert.equal(quotaCooldownMsFromError('Please try again in 2m'), 120000);
    assert.equal(quotaCooldownMsFromError('Please try again in 1h30m'), 5400000);
    assert.equal(quotaCooldownMsFromError('Please try again in 3m22.176s'), 202176);
    assert.equal(quotaCooldownMsFromError('Please try again in 5.43s'), 5430);
    assert.equal(quotaCooldownMsFromError('Please try again in 1.5s'), 1500);
    assert.equal(quotaCooldownMsFromError('HTTP 429: high demand'), 60000);
  } finally {
    if (previous === undefined) delete process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS;
    else process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS = previous;
  }
});

test('a shorter later quota error cannot shorten an active provider cooldown', () => {
  resetProviderQuotaCooldowns();
  const provider = 'groq:openai/gpt-oss-120b';
  markProviderQuota(provider, 120000);
  const checkAt = Date.now() + 60000;
  markProviderQuota(provider, 1000);
  assert.equal(isProviderQuotaBlocked(provider, checkAt), true);
  resetProviderQuotaCooldowns();
});
