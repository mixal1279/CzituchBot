'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GEMINI_VALIDATOR_JSON_SCHEMA,
  normalizujWynikWalidatora,
} = require('../ai/validator');

test('Gemini payload without aggregate booleans is locally evaluated, not marked unavailable', () => {
  const payload = {
    valid: true,
    reason: 'JSON válido con claims',
    confidence: 0.9,
    unsupported_claims: [],
    claims: [],
  };

  const result = normalizujWynikWalidatora(payload, 'gemini-test', 'gemini', new Set(), '', '');

  assert.ok(result, 'a valid core payload must reach local validation');
  assert.equal(result.status, 'inconclusive', 'missing claims must never be accepted');
  assert.equal(result.ok, false);
});

test('Gemini structured schema does not require optional aggregate booleans', () => {
  assert.deepEqual(
    GEMINI_VALIDATOR_JSON_SCHEMA.required,
    ['valid', 'reason', 'confidence', 'unsupported_claims', 'claims'],
  );
});
