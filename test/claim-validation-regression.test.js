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
    'Dodatkowo pojawia się nowa, ważna postać.',
  ]) {
    assert.deepEqual(wyodrebnijNazwyWlasne(claim), []);
  }
});

test('real first-word names Artur and Arthur remain detectable', () => {
  assert.ok(wyodrebnijNazwyWlasne('Artur opuścił miasto.').includes('artur'));
  assert.ok(wyodrebnijNazwyWlasne('Arthur opuścił miasto.').includes('arthur'));
  assert.ok(wyodrebnijNazwyWlasne('Dodatkowo Alex ma zielone oczy.').includes('alex'));
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

test('Polish localized Elden Ring weapon name aliases to the English Greatsword entity', () => {
  const { wyodrebnijNazwyWlasne: extractNames } = require('../ai/claimValidation');
  assert.deepEqual(extractNames('Wielki Miecz znajduje się w Caelid.'), ['greatsword', 'caelid']);
  const result = zgodnoscStrukturalna(
    'The Greatsword can be found in Caelid.',
    'Wielki Miecz można znaleźć w Caelid.',
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

test('one shared concept cannot cover a sentence that adds multiple unsupported events', () => {
  const { sprawdzPokrycieClaimamiOdpowiedzi } = require('../ai/claimValidation');
  const result = sprawdzPokrycieClaimamiOdpowiedzi(
    'Arthur betrayed Dutch, rescued John, and ended the conflict with Micah.',
    [{ claim: 'Arthur betrayed Dutch.' }],
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.uncoveredSentenceIndexes, [0]);
});

test('English causal relation markers remain hard failures when evidence lacks the cause', () => {
  for (const marker of ['led to', 'resulted in', 'as a result']) {
    const result = zgodnoscStrukturalna(
      'Wheatley took control of the system.',
      'Wheatley took control of the system, which ' + marker + ' his escape.',
    );
    assert.equal(result.ok, false, marker + ': ' + result.reason);
    assert.match(result.reason, /przyczynow|semantyczn|pokrycie/i);
  }
});

test('purpose clauses are not misclassified as unsupported causal relations', () => {
  const cases = [
    [
      'Astarion chce przeżyć jego historię.',
      'Astarion chce, aby przeżyć jego historię.',
    ],
    [
      'Dragonborn używa krzyku, by wchłonąć duszę smoka.',
      'Dragonborn używa krzyku, aby wchłonąć duszę smoka.',
    ],
  ];
  for (const [evidence, claim] of cases) {
    const result = zgodnoscStrukturalna(evidence, claim, { allowCrossLanguageExactEvidence: true });
    assert.equal(result.ok, true, result.reason);
  }
});
