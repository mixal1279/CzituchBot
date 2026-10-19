'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { GROQ_VALIDATOR_JSON_SCHEMA } = require('../ai/validator');

test('Groq strict validator schema satisfies Structured Outputs object requirements', () => {
  const schema = GROQ_VALIDATOR_JSON_SCHEMA;
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    [...schema.required].sort(),
    Object.keys(schema.properties).sort(),
    'every top-level property must be required in Groq strict mode',
  );

  const claims = schema.properties.claims;
  assert.equal(claims.type, 'array');
  assert.equal(claims.items.type, 'object');
  assert.equal(claims.items.additionalProperties, false);
  assert.deepEqual(
    [...claims.items.required].sort(),
    Object.keys(claims.items.properties).sort(),
    'every claim property must be required in Groq strict mode',
  );
});

test('Groq strict schema preserves fields consumed by the shared local verifier', () => {
  const schema = GROQ_VALIDATOR_JSON_SCHEMA;
  for (const field of ['valid', 'reason', 'confidence', 'unsupported_claims', 'claims', 'ok', 'supported', 'relevant', 'complete', 'hallucination']) {
    assert.ok(Object.hasOwn(schema.properties, field), `missing top-level field: ${field}`);
  }
  for (const field of ['claim', 'supported', 'source_ids', 'evidence_quote', 'claim_en', 'reason']) {
    assert.ok(Object.hasOwn(schema.properties.claims.items.properties, field), `missing claim field: ${field}`);
  }
});
