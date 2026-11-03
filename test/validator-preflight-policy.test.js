'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlockingPreflightFailure } = require('../ai/validator-preflight-policy');

test('production-latency overruns are degraded capacity for every provider', () => {
  for (const provider of ['Gemini', 'xKiro', 'OpenRouter', 'Groq']) {
    assert.equal(isBlockingPreflightFailure({
      provider,
      verdict: 'ZA WOLNY dla produkcji (>12000 ms)',
    }), false, provider);
  }
});

test('probe timeouts are transient and do not block strict preflight', () => {
  for (const provider of ['Gemini', 'xKiro', 'OpenRouter', 'Groq']) {
    for (const verdict of ['TIMEOUT >20000 ms', 'TIMEOUT >15000 ms']) {
      assert.equal(isBlockingPreflightFailure({ provider, verdict }), false, `${provider}: ${verdict}`);
    }
  }
});

test('HTTP 429 and transient 5xx responses are degraded, not blocking', () => {
  for (const provider of ['Gemini', 'xKiro', 'OpenRouter', 'Groq']) {
    for (const status of [408, 425, 429, 500, 502, 503, 504, 529]) {
      assert.equal(isBlockingPreflightFailure({
        provider,
        http: status,
        verdict: `BŁĄD HTTP ${status}: temporary provider failure`,
      }), false, `${provider}: HTTP ${status}`);
    }
  }
});

test('authentication and other deterministic HTTP errors remain blocking', () => {
  for (const provider of ['Gemini', 'xKiro', 'OpenRouter', 'Groq']) {
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(isBlockingPreflightFailure({
        provider,
        http: status,
        verdict: `BŁĄD HTTP ${status}: request rejected`,
      }), true, `${provider}: HTTP ${status}`);
    }
  }
});

test('network and malformed response failures remain blocking', () => {
  for (const verdict of [
    'BŁĄD SIECI: socket hang up',
    'NIEPOPRAWNY JSON',
    'UCIĘTY JSON (finish=MAX_TOKENS: limit output tokens za mały)',
    'PUSTY content (finish=length)',
  ]) {
    assert.equal(isBlockingPreflightFailure({ provider: 'xKiro', verdict }), true, verdict);
  }
});

test('empty HTTP 200 OpenRouter completion is degraded optional capacity', () => {
  assert.equal(isBlockingPreflightFailure({
    provider: 'OpenRouter',
    verdict: 'PUSTY content (finish=null)',
  }), false);
});

test('other empty provider responses remain blocking', () => {
  for (const provider of ['Gemini', 'xKiro', 'Groq']) {
    assert.equal(isBlockingPreflightFailure({
      provider,
      verdict: 'PUSTY content (finish=null)',
    }), true, provider);
  }
});

test('successful providers never block preflight', () => {
  for (const provider of ['Gemini', 'xKiro', 'OpenRouter', 'Groq']) {
    assert.equal(isBlockingPreflightFailure({ provider, verdict: 'OK' }), false, provider);
  }
});
