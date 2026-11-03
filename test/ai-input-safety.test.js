'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedText, constantTimeStringEqual } = require('../ai/inputSafety');

test('boundedText preserves short input and truncates long untrusted input', () => {
  assert.equal(boundedText('abc', 3), 'abc');
  assert.equal(boundedText('abcdef', 3), 'abc');
  assert.equal(boundedText(null, 3), '');
});

test('constantTimeStringEqual compares exact UTF-8 strings', () => {
  assert.equal(constantTimeStringEqual('Geralt', 'Geralt'), true);
  assert.equal(constantTimeStringEqual('Łódź', 'Łódź'), true);
  assert.equal(constantTimeStringEqual('Geralt', 'geralt'), false);
  assert.equal(constantTimeStringEqual('Geralt', 'Geraltx'), false);
  assert.equal(constantTimeStringEqual('', ''), true);
  assert.equal(constantTimeStringEqual('x'.repeat(513), 'x'.repeat(513)), false);
});
