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

test('empty HTTP 200 OpenRouter completion is degraded optional capacity, not a benchmark blocker', () => {
  assert.equal(isBlockingPreflightFailure({
    provider: 'OpenRouter',
    verdict: 'PUSTY content (finish=null)',
  }), false);
});

test('other OpenRouter failures remain blocking so real provider faults are visible', () => {
  for (const verdict of [
    'ZA WOLNY dla produkcji (>6000 ms)',
    'BŁĄD HTTP 503',
    'NIEPOPRAWNY JSON (finish=stop)',
    'TIMEOUT >20000 ms',
    'PUSTY content (finish=length)',
  ]) {
    assert.equal(isBlockingPreflightFailure({ provider: 'OpenRouter', verdict }), true, verdict);
  }
});

test('primary provider failures remain blocking', () => {
  for (const provider of ['Gemini', 'Groq']) {
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
