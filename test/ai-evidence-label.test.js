'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  usunEtykietyDowodow,
  sprawdzPokrycieClaimamiOdpowiedzi,
} = require('../ai/claimValidation');
const { finalText, STATUS } = require('../ai/pipeline');

test('usunEtykietyDowodow removes candidate labels in brackets and inline forms', () => {
  assert.equal(usunEtykietyDowodow('Zdanie. (EVIDENCE CANDIDATE 4)'), 'Zdanie.');
  assert.equal(usunEtykietyDowodow('Zdanie [EVIDENCE CANDIDATE 2].'), 'Zdanie.');
  assert.equal(usunEtykietyDowodow('Zdanie (EVIDENCE CANDIDATES 1, 3).'), 'Zdanie.');
  assert.equal(usunEtykietyDowodow('Pierwsze (EVIDENCE CANDIDATE 1). Drugie (EVIDENCE CANDIDATE 2).'), 'Pierwsze. Drugie.');
  assert.equal(usunEtykietyDowodow('Zdanie EVIDENCE CANDIDATE 4: SOURCE 5.'), 'Zdanie.');
});

test('usunEtykietyDowodow leaves ordinary text unchanged', () => {
  const plain = 'Wheatley   przejął kontrolę.  Evidence is everywhere, a candidate wygrał.';
  assert.equal(usunEtykietyDowodow(plain), plain);
  assert.equal(usunEtykietyDowodow(''), '');
  assert.equal(usunEtykietyDowodow(null), '');
});

test('candidate labels do not become uncovered factual clauses', () => {
  const answer = 'Wheatley przejął kontrolę nad GLaDOS.';
  const claims = [{ claim: 'Wheatley przejął kontrolę nad GLaDOS.' }];
  const clean = sprawdzPokrycieClaimamiOdpowiedzi(answer, claims);
  const labeled = sprawdzPokrycieClaimamiOdpowiedzi(`${answer} (EVIDENCE CANDIDATE 4)`, claims);
  assert.equal(clean.ok, labeled.ok);
  assert.equal(labeled.totalSentences, clean.totalSentences);
  assert.deepEqual(labeled.uncoveredSentenceIndexes, clean.uncoveredSentenceIndexes);
});

test('a genuine uncovered sentence remains detectable when followed by a candidate label', () => {
  const answer = 'Wheatley przejął kontrolę nad GLaDOS. Skyrim ma smoki i kapłanów smoków. (EVIDENCE CANDIDATE 4)';
  const claims = [{ claim: 'Wheatley przejął kontrolę nad GLaDOS.' }];
  const result = sprawdzPokrycieClaimamiOdpowiedzi(answer, claims);
  assert.equal(result.ok, false);
  assert.equal(result.uncoveredSentenceIndexes.length, 1);
});

test('finalText strips candidate labels from accepted, soft-accepted and unverified output', () => {
  const answer = 'Wheatley przejął kontrolę nad GLaDOS. (EVIDENCE CANDIDATE 4)';
  assert.ok(!/EVIDENCE CANDIDATE/i.test(finalText(answer, STATUS.ACCEPTED, {})));
  assert.ok(!/EVIDENCE CANDIDATE/i.test(finalText(answer, STATUS.UNVERIFIED, {})));
  assert.ok(!/EVIDENCE CANDIDATE/i.test(finalText(answer, STATUS.SOFT_ACCEPTED, { partialAnswer: answer })));
  assert.match(finalText(answer, STATUS.REJECTED, {}), /Nie mam wystarczających danych/);
});
