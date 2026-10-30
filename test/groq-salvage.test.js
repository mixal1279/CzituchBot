'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { salvageGroqJsonSchemaFailure } = require('../ai/groq-salvage');

const payload = {
  model: 'openai/gpt-oss-20b',
  response_format: { type: 'json_schema', json_schema: { name: 'czituch_validator' } },
};

test('Groq validator salvage exposes valid failed_generation JSON for local validation', () => {
  const result = salvageGroqJsonSchemaFailure({
    status: 400,
    code: 'json_validate_failed',
    failed_generation: '{"valid":false,"claims":[]}',
  }, payload);
  assert.equal(result.salvaged_failed_generation, true);
  assert.equal(result.model, payload.model);
  assert.equal(JSON.parse(result.choices[0].message.content).valid, false);
});

test('Groq validator salvage rejects generator requests, unrelated errors, and invalid JSON', () => {
  assert.equal(salvageGroqJsonSchemaFailure({ status: 400, code: 'json_validate_failed', failed_generation: '{}' }, { model: 'x' }), null);
  assert.equal(salvageGroqJsonSchemaFailure({ status: 429, code: 'json_validate_failed', failed_generation: '{}' }, payload), null);
  assert.equal(salvageGroqJsonSchemaFailure({ status: 400, code: 'json_validate_failed', failed_generation: '{bad' }, payload), null);
});
