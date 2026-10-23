'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAUSAL_RE,
  spojnoscTlumaczeniaClaimu,
  wyodrebnijNazwyWlasne,
} = require('../ai/claimValidation');

test('sentence-initial quantifiers are not extracted as proper names', () => {
  const names = wyodrebnijNazwyWlasne('Wszystkie szczegóły opisuje Artur w swoim dzienniku.');
  assert.equal(names.includes('wszystkie'), false);
  assert.equal(names.includes('artur'), true);
});

test('curly apostrophes in inflected names remain intact during normalization', () => {
  const names = wyodrebnijNazwyWlasne('Johnny’ego Silverhanda spotyka Geralt.');
  assert.equal(names.includes('johnny’ego'), true);
  assert.equal(names.includes('johnny ego'), false);
});

test('purpose connectors are not treated as causal evidence markers by themselves', () => {
  for (const phrase of [
    'Aby uratować drużynę, bohater ruszył dalej.',
    'Żeby otworzyć drzwi, gracz nacisnął przycisk.',
    'W celu zdobycia klucza postać weszła do budynku.',
    'Celem misji było odnalezienie artefaktu.',
  ]) {
    assert.equal(CAUSAL_RE.test(phrase), false, phrase);
  }
});

test('epistemic reason-why translation remains equivalent across Polish and English', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Nie ma danych potwierdzających przyczynę, dla której Wheatley przejął kontrolę nad Aperture.',
    'There is no data confirming the reason why Wheatley took control of Aperture.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('translation still rejects a changed causal relation', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture, ponieważ GLaDOS zniknęła.',
    'Wheatley took control of Aperture after GLaDOS disappeared.',
  );
  assert.equal(result.ok, false);
});
