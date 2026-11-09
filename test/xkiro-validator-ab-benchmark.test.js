'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CASES, parseJson, metrics } = require('../scripts/xkiro-validator-ab-benchmark');

test('xKiro A/B dataset has balanced supported and unsupported cases', () => {
  assert.equal(CASES.length, 12);
  assert.equal(CASES.filter(row => row[1] === true).length, 6);
  assert.equal(CASES.filter(row => row[1] === false).length, 6);
});

test('validator response parser accepts JSON and rejects malformed output', () => {
  assert.deepEqual(parseJson('{"valid":true}'), { valid: true });
  assert.equal(parseJson('not json'), null);
});

test('metrics distinguish false acceptance from false rejection', () => {
  const result = metrics([
    { expected: true, actual: true },
    { expected: false, actual: false },
    { expected: false, actual: true },
    { expected: true, actual: false },
    { expected: true, actual: null },
    { expected: false, error: 'timeout' },
  ]);
  assert.equal(result.tp, 1);
  assert.equal(result.tn, 1);
  assert.equal(result.fp, 1);
  assert.equal(result.fn, 1);
  assert.equal(result.malformed, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.accuracy, 0.5);
  assert.equal(result.falseAcceptanceRate, 0.5);
  assert.equal(result.falseRejectionRate, 0.5);
});
