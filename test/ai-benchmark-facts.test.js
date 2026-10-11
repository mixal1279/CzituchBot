'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeFactText, containsNormalizedPhrase, scoreGoldenFacts } = require('../ai/benchmark-facts');

test('normalizes Polish diacritics and whitespace without deleting letters', () => {
  assert.equal(normalizeFactText('Przejął kontrolę nad GLaDOS.'), 'przejal kontrole nad glados');
});

test('golden facts require every token in each required group', () => {
  const factual = {
    independentGold: true,
    mustInclude: [['Wheatley', 'przejął kontrolę'], ['GLaDOS', 'wyłączona']],
    mustNot: [],
  };
  const good = scoreGoldenFacts('Wheatley przejął nad GLaDOS kontrolę, a GLaDOS została wyłączona.', factual);
  assert.equal(good.passed, true);
  assert.equal(good.score, 1);

  const bad = scoreGoldenFacts('Wheatley przejął kontrolę nad GLaDOS.', factual);
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.missing, [['GLaDOS', 'wyłączona']]);
});

test('forbidden phrases use normalized whole-phrase matching', () => {
  const factual = { independentGold: true, mustInclude: [], mustNot: ['nie została wyłączona'] };
  assert.equal(scoreGoldenFacts('GLaDOS nie została wyłączona.', factual).passed, false);
  assert.equal(containsNormalizedPhrase('GLaDOS została wyłączona.', 'wyłączona'), true);
  assert.equal(containsNormalizedPhrase('wyłączonej sytuacji', 'wyłączona'), false);
});

test('non-gold cases are not scored as factual failures', () => {
  assert.deepEqual(scoreGoldenFacts('dowolna odpowiedź', {}), {
    applicable: false, score: null, passed: null, missing: [], forbidden: [],
  });
});
