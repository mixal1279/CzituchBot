'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { quotaCooldownMsFromError, geminiGenerationCooldownMsFromError, openRouterErrorMessage, classifyFailure, shouldOpenQuotaCircuit } = require('../ai/fallback');

process.env.NODE_ENV = 'test';

test('quotaCooldownMsFromError honors Retry-After header as RFC1123 date', () => {
  // HTTP-date values have one-second precision, so toUTCString() truncates
  // the milliseconds. Allow for that truncation plus normal test execution time.
  const now = Date.now();
  const futureMs = 45_000;
  const dateStr = new Date(now + futureMs).toUTCString();

  const err = {
    message: 'rate limited',
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? dateStr : null) },
  };

  const ms = quotaCooldownMsFromError(err);
  // The date format can lose up to 999ms; leave a small additional timing margin.
  assert.ok(ms >= futureMs - 1200 && ms <= futureMs + 2000, `expected ~${futureMs}ms, got ${ms}ms`);
});

test('quotaCooldownMsFromError prefers Retry-After header over message-based durations', () => {
  // Header says 5 seconds, message says try again in 1h — header must win
  const err = {
    message: 'try again in 1h',
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '5' : null) },
  };

  const ms = quotaCooldownMsFromError(err);
  assert.equal(ms, 5000);
});

test('Gemini generation cooldown honors Retry-After and separates daily quota from short rate limits', () => {
  assert.equal(geminiGenerationCooldownMsFromError('HTTP 429: rate limit exceeded (Retry-After=5s)'), 5000);
  assert.equal(geminiGenerationCooldownMsFromError('HTTP 429: rate limit exceeded'), 90_000);
  assert.equal(geminiGenerationCooldownMsFromError('HTTP 429: quota exceeded for tokens per day (TPD)'), 24 * 60 * 60 * 1000);
  assert.equal(geminiGenerationCooldownMsFromError('HTTP 402: Prepay credit balance is depleted'), 24 * 60 * 60 * 1000);
  assert.equal(geminiGenerationCooldownMsFromError('HTTP 503: service temporarily unavailable'), 0);
});

test('Gemini generation cooldown detects structured HTTP status even without quota wording', () => {
  assert.equal(geminiGenerationCooldownMsFromError({ status: 402, message: 'payment required' }), 24 * 60 * 60 * 1000);
  assert.equal(geminiGenerationCooldownMsFromError({ status: 429, message: 'too many requests' }), 90_000);
  assert.equal(geminiGenerationCooldownMsFromError({ status: 400, message: 'bad request' }), 0);
});

test('OpenRouter error envelope in HTTP 200 preserves typed provider error and retry hint', () => {
  const message = openRouterErrorMessage(200, {
    error: {
      code: 429,
      message: 'Rate limit exceeded',
      metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited' },
    },
  }, 'Retry-After=60s');

  assert.match(message, /HTTP 429/);
  assert.match(message, /error_type=rate_limit_exceeded/);
  assert.match(message, /provider_code=rate_limited/);
  assert.match(message, /Retry-After=60s/);
  assert.equal(classifyFailure(message), 'quota');
});

test('OpenRouter 402 in-flight budget keeps the documented retryable exception identifiable', () => {
  const message = openRouterErrorMessage(402, {
    error: {
      code: 402,
      message: 'In-flight spending budget exceeded',
      metadata: { limit_source: 'openrouter_in_flight_budget' },
    },
  }, 'Retry-After=5s');

  assert.match(message, /HTTP 402/);
  assert.match(message, /limit_source=openrouter_in_flight_budget/);
  assert.equal(shouldOpenQuotaCircuit(message), false);
});

test('OpenRouter provider overload is classified as transient from its HTTP status', () => {
  const message = openRouterErrorMessage(503, {
    error: { code: 503, message: 'No available provider', metadata: { error_type: 'provider_overloaded' } },
  });

  assert.equal(classifyFailure(message), 'transient');
});
