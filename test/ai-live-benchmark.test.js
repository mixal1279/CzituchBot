'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFactText, scoreGoldenFacts } = require('../ai/benchmark-scorer');

test('benchmark factual normalization preserves words with Polish diacritics and collapses whitespace', () => {
  assert.equal(normalizeFactText('Święty Łukasz  —  przejął kontrolę.'), 'swiety lukasz przejal kontrole');
});

test('gold facts require normalized whole phrases, not accidental substrings', () => {
  const facts = { independentGold: true, mustInclude: [['Wheatley', 'przejął kontrolę']], mustNot: ['GLaDOS nie została wyłączona'] };
  assert.equal(scoreGoldenFacts('Wheatley przejął kontrolę nad GLaDOS.', facts).passed, true);
  const falsePositive = scoreGoldenFacts('Wheatley przejął kontrolowanie; ślad kontrolowania pozostał.', facts);
  assert.equal(falsePositive.passed, false);
  assert.deepEqual(falsePositive.missing, [['Wheatley', 'przejął kontrolę']]);
});

test('forbidden golden fact is detected after Polish normalization', () => {
  const result = scoreGoldenFacts('Wheatley przejął kontrolę, a GLaDOS nie została wyłączona.', {
    independentGold: true,
    mustInclude: [['Wheatley']],
    mustNot: ['GLaDOS nie została wyłączona'],
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.forbidden, ['GLaDOS nie została wyłączona']);
});
