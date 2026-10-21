'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sprawdzPokrycieClaimamiOdpowiedzi } = require('../ai/claimValidation');

test('an escape claim cannot cover an additional unsupported facility-maintenance fact', () => {
  const answer = 'Celem tego działania było utrzymanie funkcjonowania Aperture Science i umożliwienie ucieczki z rozbitego ośrodka.';
  const result = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Celem transferu było umożliwienie ucieczki Wheatleya i Chell z rozbitych obiektów.' },
  ]);

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(result.uncoveredSentenceIndexes, [0]);
});

test('unrelated claims cannot assemble support for an unsupported combined relation', () => {
  const answer = 'Wheatley przejął kontrolę nad GLaDOS, a Chell zniszczyła rdzeń po ucieczce.';
  const result = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Wheatley przejął kontrolę nad GLaDOS.' },
    { claim: 'Chell uciekła z obiektu.' },
  ]);

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(result.uncoveredSentenceIndexes, [0]);
});

test('several atomic claims can jointly cover the same answer sentence', () => {
  const answer = 'Wheatley przejął kontrolę nad GLaDOS po transferze rdzeni, który przeniósł rdzeń GLaDOS na Wheatleya.';
  const result = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Wheatley przejął kontrolę nad GLaDOS po transferze rdzeni.' },
    { claim: 'Transfer przeniósł rdzeń GLaDOS na Wheatleya.' },
  ]);

  assert.equal(result.ok, true, JSON.stringify(result));
});
