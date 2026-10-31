'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlockingPreflightFailure } = require('../ai/validator-preflight-policy');

test('slow optional xKiro is reported but does not block strict benchmark preflight', () => {
  assert.equal(isBlockingPreflightFailure({
    provider: 'xKiro',
    verdict: 'ZA WOLNY dla produkcji (>6000 ms)',
  }), false);
});

test('xKiro transport, HTTP and malformed response failures remain blocking', () => {
  for (const verdict of [
    'TIMEOUT >20000 ms',
    'BŁĄD HTTP 429: rate limit',
    'NIEPOPRAWNY JSON',
    'PUSTY content',
  ]) {
    assert.equal(isBlockingPreflightFailure({ provider: 'xKiro', verdict }), true, verdict);
  }
});

test('primary and other validator provider failures remain blocking', () => {
  for (const provider of ['Gemini', 'OpenRouter', 'Groq']) {
    assert.equal(isBlockingPreflightFailure({
      provider,
      verdict: 'ZA WOLNY dla produkcji (>6000 ms)',
    }), true, provider);
    assert.equal(isBlockingPreflightFailure({ provider, verdict: 'BŁĄD HTTP 503' }), true, provider);
  }
});

test('successful providers never block preflight', () => {
  for (const provider of ['Gemini', 'xKiro', 'OpenRouter', 'Groq']) {
    assert.equal(isBlockingPreflightFailure({ provider, verdict: 'OK' }), false, provider);
  }
});
