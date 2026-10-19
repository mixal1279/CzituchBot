'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { quotaCooldownMsFromError } = require('../ai/fallback');

process.env.NODE_ENV = 'test';

test('quotaCooldownMsFromError honors Retry-After header as RFC1123 date', () => {
  // construct a Retry-After HTTP-date 45s in the future
  const now = Date.now();
  const futureMs = 45_000;
  const dateStr = new Date(now + futureMs).toUTCString(); // RFC1123-like

  const err = {
    message: 'rate limited',
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? dateStr : null) },
  };

  const ms = quotaCooldownMsFromError(err);
  // Allow some leeway for timing during the test run (±150ms)
  assert.ok(ms >= futureMs - 200 && ms <= futureMs + 2000, `expected ~${futureMs}ms, got ${ms}ms`);
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
