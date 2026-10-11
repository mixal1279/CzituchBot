'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeFactText, scoreGoldenFacts } = require('../scripts/benchmark-scoring');

const gold = (mustInclude, mustNot = []) => ({ independentGold: true, mustInclude, mustNot });

test('normalizacja zachowuje cyfry i usuwa polskie znaki', () => {
  assert.equal(normalizeFactText('Wyłączona w 2077 roku!'), 'wylaczona w 2077 roku');
});

test('krótki token "nie" nie pasuje do prefiksu "niezależnie"', () => {
  const r = scoreGoldenFacts('Niezależnie od tego Ciri uciekła.', gold([['Ciri', 'nie']]));
  assert.equal(r.passed, false);
  const ok = scoreGoldenFacts('Ciri nie chciała tego.', gold([['Ciri', 'nie']]));
  assert.equal(ok.passed, false, 'frazy Ciri i nie to osobne słowa nieadjacentne -> fraza wielowyrazowa wymaga sąsiedztwa');
});

test('fraza wielowyrazowa wymaga kolejności i sąsiedztwa', () => {
  assert.equal(scoreGoldenFacts('Wheatley przejął kontrolę nad ośrodkiem.', gold([['przejął kontrolę']])).passed, true);
  assert.equal(scoreGoldenFacts('Kontrolę nad ośrodkiem przejął Wheatley.', gold([['przejął kontrolę']])).passed, false);
  assert.equal(scoreGoldenFacts('Wheatley przejął całą kontrolę.', gold([['przejął kontrolę']])).passed, false);
});

test('fleksja: dłuższy rdzeń pasuje do słowa z krótką końcówką', () => {
  assert.equal(scoreGoldenFacts('Astarion dołączył do drużyny.', gold([['drużyn']])).passed, true);
  assert.equal(scoreGoldenFacts('Astarion dołączył do drużynowego rajdu na koniec świata.', gold([['drużyn']])).passed, false);
});

test('mustNot wykrywa zakazaną frazę jako całość', () => {
  const r = scoreGoldenFacts('To był Wheatley.', { independentGold: true, mustInclude: [['Wheatley']], mustNot: ['Chell'] });
  assert.equal(r.passed, true);
  const bad = scoreGoldenFacts('To była Chell.', { independentGold: true, mustInclude: [['Chell']], mustNot: ['Chell'] });
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.forbidden, ['Chell']);
});

test('przypadek bez gold nie jest oceniany', () => {
  assert.equal(scoreGoldenFacts('cokolwiek', {}).applicable, false);
});
