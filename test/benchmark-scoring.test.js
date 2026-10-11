'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeFactText, scoreGoldenFacts } = require('../scripts/benchmark-scoring');

const gold = (mustInclude, mustNot = []) => ({ independentGold: true, mustInclude, mustNot });

test('normalizacja zachowuje cyfry i usuwa polskie znaki', () => {
  assert.equal(normalizeFactText('Wyłączona w 2077 roku!'), 'wylaczona w 2077 roku');
});

test('krótki token "nie" nie pasuje do prefiksu "niezależnie"', () => {
  assert.equal(scoreGoldenFacts('Niezależnie od tego Ciri uciekła.', gold([['Ciri', 'nie']])).passed, false);
  assert.equal(scoreGoldenFacts('Ciri nie chciała tego.', gold([['Ciri', 'nie']])).passed, true);
});

test('fraza wielowyrazowa wymaga kolejności i sąsiedztwa', () => {
  assert.equal(scoreGoldenFacts('Wheatley przejął kontrolę nad ośrodkiem.', gold([['przejął kontrolę']])).passed, true);
  assert.equal(scoreGoldenFacts('Kontrolę nad ośrodkiem przejął Wheatley.', gold([['przejął kontrolę']])).passed, false);
  assert.equal(scoreGoldenFacts('Wheatley przejął całą kontrolę.', gold([['przejął kontrolę']])).passed, false);
});

test('fleksja: dłuższy rdzeń pasuje do słowa z krótką końcówką', () => {
  assert.equal(scoreGoldenFacts('Astarion dołączył do drużyny.', gold([['drużyn']])).passed, true);
  assert.equal(scoreGoldenFacts('Astarion dołączył do drużynowego rajdu.', gold([['drużyn']])).passed, false);
});

test('mustNot wykrywa zakazaną frazę', () => {
  const ok = scoreGoldenFacts('To był Wheatley.', { independentGold: true, mustInclude: [['Wheatley']], mustNot: ['Chell'] });
  assert.equal(ok.passed, true);
  const bad = scoreGoldenFacts('To była Chell.', { independentGold: true, mustInclude: [['Chell']], mustNot: ['Chell'] });
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.forbidden, ['Chell']);
});

test('przypadek bez gold nie jest oceniany', () => {
  assert.equal(scoreGoldenFacts('cokolwiek', {}).applicable, false);
});
