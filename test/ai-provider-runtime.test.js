'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGroqCompletion, awaitWithAbortTimeout, computeValidatorTimeout, computeValidatorReserveMs, computeGenerationTimeout } = require('../ai/provider-runtime');
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

test('validator reserve adapts to remaining time and slots without wasting the final slot', () => {
  assert.equal(computeValidatorReserveMs(25000, 1, 3), 10500);
  assert.equal(computeValidatorReserveMs(13000, 1, 3), 6500);
  assert.equal(computeValidatorReserveMs(8000, 1, 3), 2500);
  assert.equal(computeValidatorReserveMs(5000, 1, 3), 2500);
  assert.equal(computeValidatorReserveMs(1, 1, 3), 2500, 'positive remaining time must never drop the fallback reserve to zero');
  assert.equal(computeValidatorTimeout(5000, {
    reserveMs: computeValidatorReserveMs(5000, 1, 3),
    minTimeoutMs: 4000,
  }), null);

  assert.equal(computeValidatorReserveMs(12000, 2, 3), 6500);
  assert.equal(computeValidatorReserveMs(8000, 2, 3), 2500);
  assert.equal(computeValidatorReserveMs(5000, 2, 3), 2500);

  assert.equal(computeValidatorReserveMs(15000, 3, 3), 2500);
  assert.equal(computeValidatorReserveMs(5000, 3, 3), 2500);
});

test('generation timeout skips calls that cannot run for long enough while preserving fallback reserve', () => {
  assert.equal(computeGenerationTimeout(25000), 12000);
  assert.equal(computeGenerationTimeout(16000), 11500);
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
    ['120B global circuit breaker/request quota', 'budget_exhausted'],
  ];
  for (const [message, expected] of cases) assert.equal(classifyFailure(message), expected, message);
  assert.equal(classifyFailure({ status: 'rejected', reason: 'unsupported claims' }), 'validator_rejection');
  assert.equal(classifyFailure({ status: 'rejected', reason: 'invalid JSON schema from validator' }), 'schema_rejection');
  assert.equal(classifyFailure({ status: 'accepted', reason: 'grounded' }), null);
  assert.equal(classifyFailure({ status: 'inconclusive', reason: 'insufficient evidence' }), 'validator_inconclusive');
  assert.equal(classifyFailure({ status: 'unavailable', reason: 'fallback validator niedostępny' }), 'provider_unavailable');
  assert.equal(classifyFailure({ status: 'unavailable', reason: 'xKiro validator niedostępny', error: 'This operation was aborted' }), 'timeout_abort');
  assert.equal(classifyFailure('Groq chat.completions.create is unavailable; extra.requestContract={"endpoint":"chat.completions.create"}'), 'provider_unavailable');
  assert.equal(classifyFailure(JSON.stringify({ message: 'Rate limit reached on tokens per day (TPD). Please try again in 24m34.416s.', status: 429, extra: { timeoutMs: 12000 } })), 'quota', 'diagnostic timeout metadata must not mask provider TPD');
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
  resetProviderQuotaCooldowns();
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

test('quota cooldown respects Retry-After and never goes below the configured backoff', () => {
  const previous = process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS;
  process.env.AI_PROVIDER_QUOTA_COOLDOWN_MS = '5000';
  try {
    assert.equal(quotaCooldownMsFromError('HTTP 429 (Retry-After=12s)'), 12_000);
    assert.equal(quotaCooldownMsFromError('HTTP 429 rate limit'), 5_000);
    assert.equal(quotaCooldownMsFromError('HTTP 429: high demand'), 60_000);
    assert.equal(classifyFailure('HTTP 429: high demand'), 'transient');
    assert.equal(
      quotaCooldownMsFromError('Retry-After=30s; Please try again in 3m22.176s'),
      202_176,
    );
    assert.equal(quotaCooldownMsFromError('Please try again in 1h2m3s.'), 3_723_000);
    assert.equal(
      quotaCooldownMsFromError('HTTP 429: high demand; Please try again in 3m22.176s'),
      202_176,
    );

    // Groq TPM waits get a conservative 60s cooldown, not a 1h breaker.
    assert.equal(
      quotaCooldownMsFromError('Rate limit reached (TPM). Please try again in 5.43s.'),
      60_000,
    );
    // Groq TPD waits retain the provider-specified multi-minute cooldown.
    assert.ok(
      quotaCooldownMsFromError('Rate limit reached (TPD). Please try again in 24m34.416s.') >= 24 * 60_000,
    );
    assert.ok(
      quotaCooldownMsFromError('Please try again in 3m22.176s') >= 3 * 60_000,
    );
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
    remainingMs: 9000,
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

test('repair fallback stops when remaining time cannot fit a minimum generation attempt', () => {
  const base = {
    remainingMs: 8499,
    generations: 1,
    maxGenerations: 6,
    repairGenerations: 0,
    maxRepairGenerations: 1,
    modelCalls: 1,
    maxModelCalls: 12,
  };
  assert.equal(repairBudgetBlockReason(base), 'insufficient_time_for_fallback');
  assert.equal(repairBudgetBlockReason({ ...base, remainingMs: 8500 }), null);
  assert.equal(repairBudgetBlockReason({ ...base, modelCalls: 12 }), 'model_calls_exhausted');
});
