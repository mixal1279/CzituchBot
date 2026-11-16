'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectOverclaimTypes, HARD_OVERCLAIM_TYPES } = require('../ai/claim-support');
const { STATUS, finalText } = require('../ai/pipeline');
const { decomposeQuestion } = require('../ai/retrieval');
const { czyOgraniczenieDowodowe, sprawdzTwardeKonflikty } = require('../ai/claimValidation');
const { isFailureText } = require('../scripts/ai-live-benchmark');

test('specialized lore sources are not treated as non-official canon authorities', () => {
  const types = detectOverclaimTypes(
    'Ta postać jest kanoniczna.',
    'Ta postać pojawia się w historii gry.',
    { sourceAuthority: 'specialized' },
  );
  assert.equal(types.includes('canon_status_not_official_source'), false);
});

test('ambiguous canon-presence heuristics are warnings, not hard claim failures', () => {
  assert.equal(HARD_OVERCLAIM_TYPES.has('canon_status_not_in_evidence'), false);
  assert.equal(HARD_OVERCLAIM_TYPES.has('canon_status_conflict'), false);
});

test('validator outage publishes only a clearly marked unverified answer', () => {
  const result = finalText('  Przykładowa odpowiedź.  ', STATUS.UNVERIFIED, {
    sanitizeResponse: value => value.trim(),
  });
  assert.equal(result, '⚠️ Odpowiedź niezweryfikowana — walidator niedostępny. Przykładowa odpowiedź.');
  assert.equal(isFailureText(result), false);
  assert.match(finalText('', STATUS.UNVERIFIED), /nie będę zgadywać/);
});

test('short comma continuation is not split into a separate question clause', () => {
  assert.deepEqual(decomposeQuestion('Opowiedz o Geralcie, kim jest i jak działa?'), []);
});

test('expanded limitation language is classified as source-scope uncertainty', () => {
  assert.equal(czyOgraniczenieDowodowe('Niestety szczegółowy opis nie jest dostępny w źródłach.'), true);
  assert.equal(czyOgraniczenieDowodowe('Geralt pokonał potwora w sierpniu.'), false);
});

test('temporal markers may be checked against the same full source block', () => {
  const quote = 'Geralt arrived in Novigrad.';
  const claim = 'Geralt arrived in Novigrad in August.';
  assert.equal(sprawdzTwardeKonflikty(quote, claim).ok, false);
  assert.equal(sprawdzTwardeKonflikty(quote, claim, {
    fullEvidenceText: 'Geralt arrived in Novigrad. This happened in August.',
  }).ok, true);
});
