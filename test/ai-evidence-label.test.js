'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  usunEtykietyDowodow,
  sprawdzPokrycieClaimamiOdpowiedzi,
} = require('../ai/claimValidation');
const { finalText, STATUS } = require('../ai/pipeline');

const ANSWER = 'Wheatley przejął kontrolę, ponieważ głowa GLaDOS została usunięta, a jego własny rdzeń umieszczono w jej ciele, co dało mu władzę nad całym ośrodkiem.';
const CLAIMS = [
  { claim: 'Wheatley przejął kontrolę, ponieważ głowa GLaDOS została usunięta, a jego własny rdzeń umieszczono w jej ciele' },
  { claim: 'Co dało mu władzę nad całym ośrodkiem.' },
];

test('usunEtykietyDowodow usuwa etykiety kandydatów dowodu', () => {
  assert.equal(usunEtykietyDowodow('Zdanie. (EVIDENCE CANDIDATE 4)'), 'Zdanie.');
  assert.equal(usunEtykietyDowodow('Zdanie [EVIDENCE CANDIDATE 2].'), 'Zdanie.');
  assert.equal(usunEtykietyDowodow('Zdanie (EVIDENCE CANDIDATES 1, 3).'), 'Zdanie.');
  assert.equal(usunEtykietyDowodow('Pierwsze (EVIDENCE CANDIDATE 1). Drugie (EVIDENCE CANDIDATE 2).'), 'Pierwsze. Drugie.');
  assert.equal(usunEtykietyDowodow('Zdanie EVIDENCE CANDIDATE 4: SOURCE 5.'), 'Zdanie.');
});

test('usunEtykietyDowodow nie zmienia zwykłego tekstu', () => {
  const plain = 'Wheatley   przejął kontrolę.  Evidence is everywhere, a candidate wygrał.';
  assert.equal(usunEtykietyDowodow(plain), plain);
  assert.equal(usunEtykietyDowodow(''), '');
  assert.equal(usunEtykietyDowodow(null), '');
});

test('etykieta kandydata nie jest liczona jako niepokryte zdanie', () => {
  const clean = sprawdzPokrycieClaimamiOdpowiedzi(ANSWER, CLAIMS);
  const labeled = sprawdzPokrycieClaimamiOdpowiedzi(`${ANSWER} (EVIDENCE CANDIDATE 4)`, CLAIMS);
  assert.equal(clean.ok, true);
  assert.equal(labeled.ok, true);
  assert.equal(labeled.totalSentences, clean.totalSentences);
  assert.deepEqual(labeled.uncoveredSentenceIndexes, []);
});

test('prawdziwe niepokryte zdanie nadal jest wykrywane', () => {
  const result = sprawdzPokrycieClaimamiOdpowiedzi(`${ANSWER} Skyrim ma smoki i kapłanów smoków. (EVIDENCE CANDIDATE 4)`, CLAIMS);
  assert.equal(result.ok, false);
  assert.equal(result.uncoveredSentenceIndexes.length, 1);
});

test('finalText nie pokazuje etykiety kandydata użytkownikowi', () => {
  const text = `${ANSWER} (EVIDENCE CANDIDATE 4)`;
  for (const status of [STATUS.ACCEPTED, STATUS.SOFT_ACCEPTED, STATUS.UNVERIFIED]) {
    const out = finalText(text, status, {});
    assert.ok(!/EVIDENCE CANDIDATE/i.test(out), status);
    assert.ok(out.includes('Wheatley przejął kontrolę'), status);
  }
  assert.match(finalText(text, STATUS.REJECTED, {}), /Nie mam wystarczających danych/);
});
