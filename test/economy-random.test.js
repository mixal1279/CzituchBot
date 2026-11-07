'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wylosujLiczbe, wylosujIndeks, wylosujBit } = require('../economy/random');

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


test('cryptographic integer draws enforce exclusive upper bounds', () => {
  for (let i = 0; i < 100; i++) {
    const value = wylosujLiczbe(1, 31);
    assert.ok(Number.isInteger(value) && value >= 1 && value < 31);
    const index = wylosujIndeks(5);
    assert.ok(Number.isInteger(index) && index >= 0 && index < 5);
  }
});

test('cryptographic integer draws reject invalid ranges and empty collections', () => {
  assert.throws(() => wylosujLiczbe(1, 1), RangeError);
  assert.throws(() => wylosujLiczbe(1.5, 3), RangeError);
  assert.throws(() => wylosujIndeks(0), RangeError);
  assert.throws(() => wylosujIndeks(-1), RangeError);
});
