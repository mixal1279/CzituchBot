'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { create120bBreaker } = require('../ai/breaker-120b');
const {
  classifyFailure,
  quotaCooldownMsFromError,
  markProviderQuota,
  isProviderQuotaBlocked,
  resetProviderQuotaCooldowns,
} = require('../ai/fallback');

function makeClock(start = 1_000_000) {
  let now = start;
  const clock = () => now;
  clock.advance = ms => { now += ms; };
  return clock;
}

test('TPD cooldown from Retry-After blocks longer than the 90s default', () => {
  const clock = makeClock();
  const breaker = create120bBreaker({ now: clock });

  const errorText =
    'Rate limit reached ... tokens per day (TPD): Limit 200000, Used 199559, Requested 3854. ' +
    'Please try again in 24m34.416s.';
  const cooldownMs = quotaCooldownMsFromError(errorText);
  assert.ok(cooldownMs >= 24 * 60_000, `expected >= 24m, got ${cooldownMs}ms`);

  breaker.trip(errorText, cooldownMs);
  const snap = breaker.snapshot();
  assert.equal(snap.breakerOpen, true);
  const remaining = snap.breakerOpenUntil - clock();
  assert.ok(remaining >= 24 * 60_000, `breaker remaining ${remaining}ms should be >= 24m`);
});

test('TPM cooldown uses the short floor, not an hour', () => {
  const clock = makeClock();
  const breaker = create120bBreaker({ now: clock, defaultCooldownMs: 90_000 });

  const errorText =
    'Rate limit reached ... tokens per minute (TPM): Limit 8000, Used 7012, Requested 1034. ' +
    'Please try again in 5.43s.';
  const cooldownMs = quotaCooldownMsFromError(errorText);
  assert.ok(cooldownMs >= 60_000, `TPM floor should be >= 60s, got ${cooldownMs}ms`);
  assert.ok(cooldownMs < 5 * 60_000, `TPM must not become multi-minute, got ${cooldownMs}ms`);

  breaker.trip('tpm', cooldownMs);
  const remaining = breaker.snapshot().breakerOpenUntil - clock();
  assert.ok(remaining < 5 * 60_000, `TPM breaker must not last hours, got ${remaining}ms`);
});

test('overload is classified as transient, not quota', () => {
  const text =
    'This model is currently experiencing high demand. Spikes in demand are usually temporary.';
  assert.equal(classifyFailure(text), 'transient');

  // Breaker pozostaje zamknięty, bo call site nie powinien wołać trip() dla transient.
  const breaker = create120bBreaker();
  assert.equal(breaker.isOpen(), false);
  assert.equal(breaker.snapshot().breakerOpen, false);
});

test('reservation respects breaker and quota cap independently', () => {
  const clock = makeClock();
  const breaker = create120bBreaker({
    now: clock,
    maxRequests: 2,
    windowMs: 60 * 60 * 1000,
    defaultCooldownMs: 30_000,
  });

  assert.equal(breaker.reserve('r1').ok, true);
  assert.equal(breaker.reserve('r2').ok, true);
  const capped = breaker.reserve('r3');
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'quota_exhausted');

  breaker.trip('tpd', 5 * 60_000);
  const blocked = breaker.reserve('r4');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'circuit_breaker_open');

  clock.advance(5 * 60_000 + 1);
  assert.equal(breaker.isOpen(), false);
});

test('endpoint cooldown and global breaker agree on TPD timing', () => {
  resetProviderQuotaCooldowns();
  const breaker = create120bBreaker();
  const errorText = 'tokens per day (TPD). Please try again in 24m34.416s.';
  const cooldownMs = quotaCooldownMsFromError(errorText);

  markProviderQuota('groq:openai/gpt-oss-120b', cooldownMs);
  breaker.trip(errorText, cooldownMs);

  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-120b'), true);
  assert.equal(breaker.isOpen(), true);
  resetProviderQuotaCooldowns();
});

test('other endpoints remain available while 120B is blocked', () => {
  resetProviderQuotaCooldowns();
  const breaker = create120bBreaker();
  breaker.trip('tpd', 24 * 60_000);
  markProviderQuota('groq:openai/gpt-oss-120b', 24 * 60_000);

  assert.equal(breaker.isOpen(), true);
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-120b'), true);

  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), false);
  assert.equal(isProviderQuotaBlocked('gemini:gemini-3.8-flash'), false);
  assert.equal(isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite'), false);
  assert.equal(isProviderQuotaBlocked('xkiro:default'), false);
  assert.equal(isProviderQuotaBlocked('openrouter:default'), false);

  resetProviderQuotaCooldowns();
});

test('breaker default cooldown applies when no error text is available', () => {
  const clock = makeClock();
  const breaker = create120bBreaker({ now: clock, defaultCooldownMs: 90_000 });

  breaker.trip('unknown', undefined);
  const remaining = breaker.snapshot().breakerOpenUntil - clock();
  assert.ok(remaining >= 89_000 && remaining <= 91_000, `expected ~90s, got ${remaining}ms`);
});
