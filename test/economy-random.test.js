'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wylosujBit } = require('../economy/random');

test('secure binary draw accepts only the two values requested from crypto.randomInt', () => {
  assert.equal(wylosujBit((min, max) => {
    assert.equal(min, 0);
    assert.equal(max, 2);
    return 0;
  }), 0);
  assert.equal(wylosujBit((min, max) => {
    assert.equal(min, 0);
    assert.equal(max, 2);
    return 1;
  }), 1);
});

test('secure binary draw rejects an invalid injected generator result', () => {
  assert.throws(() => wylosujBit(() => 2), RangeError);
  assert.throws(() => wylosujBit(() => 0.5), RangeError);
  assert.throws(() => wylosujBit(null), TypeError);
});

test('default binary draw always returns a valid bit', () => {
  for (let i = 0; i < 100; i++) {
    assert.ok([0, 1].includes(wylosujBit()));
  }
});
