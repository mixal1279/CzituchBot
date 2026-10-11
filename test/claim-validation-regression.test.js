'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  wyodrebnijNazwyWlasne,
  zgodnoscStrukturalna,
} = require('../ai/claimValidation');

test('sentence-initial generic words are not treated as proper names', () => {
  for (const claim of [
    'Decyzja ta wynikała z wcześniejszych wydarzeń.',
    'Motywuje go to do dalszego działania.',
    'Nowo uzyskana potęga zmienia sytuację.',
    'Aby rozpocząć romans, zwiększ poziom aprobaty.',
    'Dodatkowo Alex ma zielone oczy.',
  ]) {
    assert.deepEqual(wyodrebnijNazwyWlasne(claim), []);
  }
});

test('real first-word names Artur and Arthur remain detectable', () => {
  assert.ok(wyodrebnijNazwyWlasne('Artur opuścił miasto.').includes('artur'));
  assert.ok(wyodrebnijNazwyWlasne('Arthur opuścił miasto.').includes('arthur'));
});

test('apostrophe and Polish inflection variants match source name tokens', () => {
  const result = zgodnoscStrukturalna(
    'Johnny Silverhand jest znanym najemnikiem z Night City.',
    'Johnny’ego Silverhanda opisano jako znanego najemnika.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('generic sentence start no longer causes a false proper-name rejection', () => {
  const result = zgodnoscStrukturalna(
    'Decyzja ta wynikała z wcześniejszych wydarzeń w systemie.',
    'Decyzja ta wynikała z wcześniejszych wydarzeń w systemie.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('semantic paraphrase remains possible when a supported concept and entity match', () => {
  const result = zgodnoscStrukturalna(
    'Wheatley przejmuje kontrolę nad GLaDOS w komorze testowej.',
    'Wheatley zdobywa kontrolę nad GLaDOS w komorze testowej.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('numeric/date conflicts remain hard failures', () => {
  const result = zgodnoscStrukturalna(
    'Wheatley przejął kontrolę w 2011 roku.',
    'Wheatley przejął kontrolę w 2012 roku.',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /liczbę\/datę/);
});

test('negation mismatch remains a hard failure', () => {
  const result = zgodnoscStrukturalna(
    'Arthur nie zabił strażnika.',
    'Arthur zabił strażnika.',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /negację/);
});

test('unsupported causal relation remains a hard failure', () => {
  const result = zgodnoscStrukturalna(
    'Wheatley przejął kontrolę nad systemem.',
    'Wheatley przejął kontrolę nad systemem, ponieważ chciał uciec.',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /przyczynową/);
});
