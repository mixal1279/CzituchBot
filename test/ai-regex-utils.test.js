'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ucieknijRegex } = require('../ai/regex-utils');

test('escapes user-controlled regex metacharacters before dynamic RegExp construction', () => {
  const value = 'nick.+[test]';
  const pattern = new RegExp('^' + ucieknijRegex(value) + '$');
  assert.equal(pattern.test(value), true);
  assert.equal(pattern.test('nickZZtest'), false);
});

test('caps dynamic regex fragments before compiling them', () => {
  const value = 'x'.repeat(10000);
  assert.equal(ucieknijRegex(value).length, 120);
});
