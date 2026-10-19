'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { quotaCooldownMsFromError } = require('../ai/fallback');

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
