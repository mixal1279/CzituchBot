'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { tokenyPokrywajaSie } = require('../ai/claimValidation');

test('claim token matching tolerates a single edit in a long token', () => {
  assert.equal(tokenyPokrywajaSie('debuffow', 'debffow'), true);
});

test('claim token matching rejects unrelated words that only share a long prefix', () => {
  assert.equal(tokenyPokrywajaSie('internationalization', 'internationalist'), false);
});

test('claim token matching keeps exact matches and rejects short-token fuzzy matches', () => {
  assert.equal(tokenyPokrywajaSie('glados', 'glados'), true);
  assert.equal(tokenyPokrywajaSie('cat', 'cut'), false);
});
