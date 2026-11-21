'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveGameEntity } = require('../ai/entities');
const { buildAnswerPlan } = require('../ai/answer-plan');
const { detectOverclaimTypes } = require('../ai/claim-support');
const { normalizeSource } = require('../ai/core');
const { normalizeEvidenceText } = require('../ai/evidence');
const { czyPytanieOGameplay } = require('../ai/gameplay');
const { czyPytanieOLore } = require('../ai/lore');
const { buildRetrievalQueries, detectResponseProfile } = require('../ai/planner');
const { sprawdzSpojnoscLorePortal2 } = require('../ai/response');
const { selectGameSpecificRetrievalDomains } = require('../ai/retrieval');
const { czyDowodSemantyczniePokrywaClaim, spojnoscTlumaczeniaClaimu, sprawdzPokrycieClaimamiOdpowiedzi } = require('../ai/claimValidation');

test('entity and intent matchers reject oversized untrusted input', () => {
  const oversized = 'x'.repeat(20000);
  assert.equal(resolveGameEntity(oversized), null);
  assert.equal(czyPytanieOLore(oversized), false);
  assert.equal(czyPytanieOLore('Lore Portal ' + 'x'.repeat(5000)), false);
  assert.equal(czyPytanieOGameplay(oversized), false);
  assert.equal(czyPytanieOGameplay('Jak pokonać bossa ' + 'x'.repeat(5000)), false);
  assert.ok(buildAnswerPlan(oversized, {}));
  assert.equal(buildRetrievalQueries(oversized, { needs_web: true }).length, 0);
  assert.equal(detectResponseProfile(oversized, {}), 'simple');
});

test('evidence, source and claim helpers enforce bounded text sizes', () => {
  const oversized = 'A'.repeat(20000);
  assert.equal(normalizeEvidenceText(oversized).length, 12000);
  assert.equal(normalizeSource({ title: 'T', content: oversized }).content.length, 12000);
  assert.equal(czyDowodSemantyczniePokrywaClaim(oversized, 'Portal'), false);
  assert.equal(spojnoscTlumaczeniaClaimu('A'.repeat(1001), 'A'.repeat(1001)).ok, false);
  assert.deepEqual(detectOverclaimTypes('A'.repeat(1001), 'source'), ['input_too_long']);
});

test('response and retrieval guards reject oversized content before regex evaluation', () => {
  const oversized = 'x'.repeat(20000);
  assert.equal(sprawdzSpojnoscLorePortal2(oversized, 'Portal 2 Wheatley przejął kontrolę').ok, false);
  assert.deepEqual(selectGameSpecificRetrievalDomains('Portal', oversized), []);
});


test('answer claim coverage rejects oversized answer and excessive claim arrays', () => {
  assert.equal(sprawdzPokrycieClaimamiOdpowiedzi('A'.repeat(12001), []).ok, false);
  assert.equal(sprawdzPokrycieClaimamiOdpowiedzi('A short answer.', Array.from({ length: 41 }, () => ({ claim: 'A claim.' }))).ok, false);
  assert.deepEqual(
    sprawdzPokrycieClaimamiOdpowiedzi('A short answer.', [{ claim: 'A'.repeat(1001) }]).uncovered,
    ['input_too_long'],
  );
});
