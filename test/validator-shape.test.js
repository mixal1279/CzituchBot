'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { naprawKsztaltWynikuWalidatora } = require('../ai/validator-shape');

test('validator shape repair unwraps a single-key claim wrapper without inventing fields', () => {
  const input = {
    valid: true,
    supported: [{ item: { claim: 'Portal 2 was released in 2011.', supported: true, source_ids: ['1'], evidence_quote: 'Portal 2 was released in 2011.' } }],
    confidence: 'high',
  };
  const result = naprawKsztaltWynikuWalidatora(input);
  assert.equal(result.wynik.supported, true);
  assert.equal(result.wynik.claims[0].claim, 'Portal 2 was released in 2011.');
  assert.equal(result.wynik.confidence, 0.9);
  assert.deepEqual(result.poprawki, ['supported_array_as_claims', 'confidence_text_to_number']);
  assert.equal(input.supported.length, 1, 'the original response must not be mutated');
  assert.equal(input.claims, undefined, 'no claim is added to the original response');
});

test('validator shape repair leaves ambiguous or incomplete structures unchanged', () => {
  const input = { valid: true, supported: [{ first: { claim: 'A' }, second: { claim: 'B' } }], confidence: 'unknown' };
  const result = naprawKsztaltWynikuWalidatora(input);
  assert.strictEqual(result.wynik, input);
  assert.deepEqual(result.poprawki, []);
});

test('validator shape repair unwraps claim arrays but preserves strict evidence fields', () => {
  const input = { claims: [{ wrapped: { claim: 'Fact', supported: true } }] };
  const result = naprawKsztaltWynikuWalidatora(input);
  assert.equal(result.wynik.claims[0].claim, 'Fact');
  assert.equal(result.wynik.claims[0].evidence_quote, undefined);
  assert.deepEqual(result.poprawki, ['claim_wrapper_unwrapped']);
});
