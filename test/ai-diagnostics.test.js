'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serializujBladProvidera, sanitizujKomunikatBledu } = require('../ai/diagnostics');

test('provider diagnostics redact bearer tokens, API keys and URL query secrets', () => {
  const message = 'Authorization: Bearer bearer-secret API_KEY=api-secret https://provider.test/?key=query-secret';
  const sanitized = sanitizujKomunikatBledu(message);
  assert.doesNotMatch(sanitized, /bearer-secret|api-secret|query-secret/);
  assert.match(sanitized, /\[REDACTED\]/);
});

test('provider error serialization excludes request headers, bodies and credentials', () => {
  const error = new Error('Authorization: Bearer bearer-secret');
  error.status = 401;
  error.code = 'AUTH_FAILED';
  error.headers = { authorization: 'Bearer header-secret', 'set-cookie': 'session=private' };
  error.request = { headers: { 'x-api-key': 'request-secret' }, body: 'private prompt' };
  error.config = { apiKey: 'config-secret', password: 'password-secret' };
  error.cause = Object.assign(new Error('API_KEY=cause-secret'), { status: 502 });

  const serialized = serializujBladProvidera(error);
  const output = JSON.stringify(serialized);
  for (const secret of [
    'bearer-secret', 'header-secret', 'request-secret', 'private prompt',
    'config-secret', 'password-secret', 'cause-secret',
  ]) {
    assert.equal(output.includes(secret), false, 'diagnostics must not expose ' + secret);
  }
  assert.equal(serialized.status, 401);
  assert.equal(serialized.code, 'AUTH_FAILED');
  assert.equal(serialized.cause.status, 502);
  assert.match(serialized.message, /REDACTED/);
});

test('provider error serialization handles cycles and bounds nested data', () => {
  const error = new Error('safe error');
  error.cause = error;
  const serialized = serializujBladProvidera(error);
  assert.equal(serialized.cause, '[Circular]');
  assert.equal(serialized.message, 'safe error');
});
