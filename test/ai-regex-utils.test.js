'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ucieknijRegex, utworzRegexPelnejNazwy, MAX_FRAGMENT_LENGTH } = require('../ai/regex-utils');

test('escapes user-controlled regex metacharacters before dynamic RegExp construction', () => {
  const value = 'nick.+[test]';
  const pattern = new RegExp('^' + ucieknijRegex(value) + '$');
  assert.equal(pattern.test(value), true);
  assert.equal(pattern.test('nickZZtest'), false);
});

test('rejects oversized fragments instead of silently truncating their meaning', () => {
  const value = 'x'.repeat(MAX_FRAGMENT_LENGTH + 1);
  assert.throws(() => ucieknijRegex(value), RangeError);
});

test('matches Polish names with Unicode-aware boundaries', () => {
  const pattern = utworzRegexPelnejNazwy('Bliźnięta');
  assert.equal(pattern.test('Dziś Bliźnięta mają dobry dzień.'), true);
  assert.equal(pattern.test('Bliźniętami'), false);
  assert.equal(pattern.test('superBliźnięta'), false);
});

test('does not treat Polish letters as non-word separators', () => {
  const pattern = utworzRegexPelnejNazwy('Waga');
  assert.equal(pattern.test('Uwaga na szczegóły.'), false);
  assert.equal(pattern.test('Dla Wagi będzie to dobry dzień.'), false);
  assert.equal(pattern.test('Znak Waga.'), true);
});

test('returns a never-matching expression for an empty name', () => {
  assert.equal(utworzRegexPelnejNazwy('').test(''), false);
});
