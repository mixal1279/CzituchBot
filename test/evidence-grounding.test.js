'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizujWynikWalidatora } = require('../ai/validator');
const { parseEvidenceBlocks, quoteExists, buildEvidenceRepairContext, normalizeEvidenceText, classifyClaimType, evidenceRelationSignals } = require('../ai/evidence');

function base(claim, sourceId, quote, answer = claim) {
  return normalizujWynikWalidatora({
    valid: true,
    reason: 'ok',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence: 0.95,
    claims: [{ claim, supported: true, source_ids: [sourceId], evidence_quote: quote }],
  }, 'test-model', 'test', new Set([sourceId]), answer && `[${sourceId}]\nTREŚĆ: ${quote}`);
}

test('evidence parser preserves source identity and exact content', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Test\nURL: https://example.com/a\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nArthur returned to camp.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const blocks = parseEvidenceBlocks(data);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].sourceId, 'SOURCE 1');
  assert.equal(blocks[0].title, 'Test');
  assert.equal(quoteExists(blocks[0].content, 'Arthur returned to camp.'), true);
  assert.equal(quoteExists(blocks[0].content, 'Arthur invented a new camp.'), false);
});

test('evidence normalization handles ł, day inflections, and Polish month inflections', () => {
  assert.equal(normalizeEvidenceText('Łódź'), 'lodz');
  assert.equal(classifyClaimType('To był dzień premiery?'), 'temporal');
  assert.equal(evidenceRelationSignals('Premiera odbyła się w grudniu.').temporal, true);
  assert.equal(evidenceRelationSignals('Aktualizacja wyszła w styczniu i lutym.').temporal, true);
});

test('validator accepts an exact quoted span without requiring the whole source block to match', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Portal 2\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nWheatley zostaje przeniesiony do ciała GLaDOS.\nPóźniej uzyskuje kontrolę nad systemem Aperture.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.95,
    claims: [{ claim: 'Wheatley zostaje przeniesiony do ciała GLaDOS.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Wheatley zostaje przeniesiony do ciała GLaDOS.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'accepted');
  assert.equal(result.diagnostics.evidenceBindings[0].mode, 'exact_quote');
});

test('validator can use the same source block as bounded context when the quote uses a pronoun', () => {
  const data = '[SOURCE 1]\nTYTUŁ: RDR2\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nArthur Morgan wrócił do obozu. On uratował Johna podczas wydarzeń w górach.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.95,
    claims: [{ claim: 'Arthur Morgan uratował Johna podczas wydarzeń w górach.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'On uratował Johna podczas wydarzeń w górach.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'accepted');
  assert.ok(['exact_quote', 'source_context'].includes(result.diagnostics.evidenceBindings[0].mode));
});

test('validator tolerates one source typo in an otherwise strongly supported paraphrase', () => {
  const source = 'Trzeba na bieżąco oczyszczać się z debffów i blokować poison oraz weaken wrzucane przez smoka.';
  const claim = 'W trakcie starcia należy na bieżąco oczyszczać się z debuffów i blokować poison oraz weaken, które smocze zdolności rzucają.';
  const data = `[SOURCE 1]\nTYTUŁ: Poradnik testowy\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\n${source}\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>`;
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true,
    complete: true, hallucination: false, confidence: 0.95,
    claims: [{ claim, supported: true, source_ids: ['SOURCE 1'], evidence_quote: source }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data, claim);
  assert.equal(result.status, 'accepted', result.reason);
  assert.equal(result.diagnostics.evidenceBindings[0].quoteVerified, true);
  assert.ok(['exact_quote', 'source_context'].includes(result.diagnostics.evidenceBindings[0].mode));
});

test('validator rejects a real quote when the claim adds an unsupported causal relationship', () => {
  const data = '[SOURCE 1]\nTYTUŁ: RDR2\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nArthur zdradził Dutcha podczas wydarzeń w obozie.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.99,
    claims: [{ claim: 'Arthur zdradził Dutcha, ponieważ chciał uratować Johna.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Arthur zdradził Dutcha podczas wydarzeń w obozie.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'rejected');
});

test('validator rejects a quote bound to an unauthorized source', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Test\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nFakt znajduje się tutaj.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.99,
    claims: [{ claim: 'Fakt znajduje się tutaj.', supported: true, source_ids: ['SOURCE 99'], evidence_quote: 'Fakt znajduje się tutaj.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'rejected');
  assert.ok(result.diagnostics.localRejectReasons.includes('unknown_source_id'));
});

test('evidence repair context returns verbatim candidates from authorized sources', () => {
  const blocks = parseEvidenceBlocks('[SOURCE 1]\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nWheatley przejął kontrolę nad systemem Aperture.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>');
  const repair = buildEvidenceRepairContext([{ claim: 'Wheatley uzyskał kontrolę nad Aperture.' }], blocks, new Set(['SOURCE 1']));
  assert.match(repair, /CANDIDATE SOURCE: SOURCE 1/);
  assert.match(repair, /Wheatley przejął kontrolę/);
});
