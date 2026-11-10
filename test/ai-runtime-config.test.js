'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePrimaryGenerator } = require('../ai/modelConfig');
const { configuredRequestTimeoutMs } = require('../ai/limits');

test('primary generator defaults to Groq and keeps its model-specific endpoint', () => {
  const result = resolvePrimaryGenerator({});
  assert.equal(result.provider, 'groq');
  assert.match(result.model, /^openai\//);
  assert.equal(result.step, `groq:${result.model}`);
});

test('primary generator can explicitly route through xKiro using the configured model', () => {
  const result = resolvePrimaryGenerator({
    AI_GENERATOR_PROVIDER: 'xkiro',
    XKIRO_MODEL: 'cohere/command-a-reasoning',
  });
  assert.deepEqual(result, {
    provider: 'xkiro',
    model: 'cohere/command-a-reasoning',
    step: 'xkiro:default',
  });
});

test('unsupported primary generator providers fail fast instead of silently calling the wrong API', () => {
  assert.throws(
    () => resolvePrimaryGenerator({ AI_GENERATOR_PROVIDER: 'cohere-direct' }),
    /AI_GENERATOR_PROVIDER must be either/,
  );
});

test('request timeout accepts bounded explicit values and safely defaults invalid values', () => {
  assert.equal(configuredRequestTimeoutMs('65000'), 65000);
  assert.equal(configuredRequestTimeoutMs('10000'), 10000);
  assert.equal(configuredRequestTimeoutMs('120000'), 120000);
  assert.equal(configuredRequestTimeoutMs('9999'), 40000);
  assert.equal(configuredRequestTimeoutMs('120001'), 40000);
  assert.equal(configuredRequestTimeoutMs('not-a-number'), 40000);
  assert.equal(configuredRequestTimeoutMs('65000.5'), 40000);
});
