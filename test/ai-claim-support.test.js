'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOverclaimTypes,
  buildClaimSupportAudit,
  summarizeClaimSupportAudits,
} = require('../ai/claim-support');
const { extractClaimSupportAudit } = require('../scripts/ai-live-benchmark');

test('claim-support audit distinguishes exact entailment, bounded-context partial support, and unsupported evidence', () => {
  const audit = buildClaimSupportAudit({
    claims: [
      { claim: 'Portal 2 was released in 2011.', source_ids: ['SOURCE 1'], evidence_quote: 'Portal 2 was released in 2011.', supported: true },
      { claim: 'Wheatley took control.', source_ids: ['SOURCE 2'], evidence_quote: 'Wheatley took control.', supported: true },
      { claim: 'GLaDOS was created in 1998.', source_ids: ['SOURCE 3'], evidence_quote: 'GLaDOS was created in 1998.', supported: true },
      { claim: 'A claim without a verified quote.', source_ids: ['SOURCE 4'], evidence_quote: 'not present in source', supported: true },
    ],
    evidenceEvaluations: [
      { ok: true, mode: 'exact_quote', reason: 'exact quote' },
      { ok: true, mode: 'source_context', reason: 'bounded context' },
      { ok: false, mode: null, reason: 'sprzeczność liczbowa' },
      { ok: false, mode: null, reason: 'quote missing' },
    ],
    evidenceQuoteVerified: [true, true, true, false],
    evidenceContexts: [
      'Portal 2 was released in 2011.',
      'Wheatley took control.',
      'GLaDOS was created in 1997.',
      'source text',
    ],
  });

  assert.deepEqual(audit.records.map(record => record.verdict), ['entailed', 'partial', 'contradicted', 'unverifiable']);
  assert.equal(audit.claimSupportPassRate, 0.25);
  assert.equal(audit.claimSupportUsableRate, 0.5);
  assert.equal(audit.verdictCounts.contradicted, 1);
  assert.equal(audit.verdictCounts.unverifiable, 1);
  assert.deepEqual(audit.records.map(record => record.claimSourceVerdict), [
    'supported', 'partial', 'contradicted', 'not_enough_evidence',
  ]);
  assert.deepEqual(audit.claimSourceVerdictCounts, {
    supported: 1,
    partial: 1,
    contradicted: 1,
    not_enough_evidence: 1,
    unsupported_by_cited_source: 0,
  });
});

test('claim-support audit flags correlation-to-causation overclaim', () => {
  assert.ok(detectOverclaimTypes(
    'The patch caused the performance increase.',
    'The patch was associated with a performance increase.',
  ).includes('correlation_to_causation'));
});

test('claim-support audit flags a hedge upgraded to an absolute', () => {
  assert.ok(detectOverclaimTypes(
    'The method always guarantees success.',
    'The method may improve the chance of success.',
  ).includes('hedge_to_absolute'));
});

test('claim-support audit flags a dropped upper-bound qualifier', () => {
  const types = detectOverclaimTypes(
    'The system improves performance by 30%.',
    'The system may improve performance by up to 30%.',
  );
  assert.ok(types.includes('up_to_qualifier_dropped'));
  assert.ok(types.includes('hedge_to_absolute'));
});

test('claim-support audit flags an unsupported quantifier', () => {
  assert.ok(detectOverclaimTypes(
    'All players choose this route.',
    'Some players choose this route.',
  ).includes('unsupported_quantifier'));
});

test('claim-support audit warns when an old dated source is presented as current', () => {
  assert.ok(detectOverclaimTypes(
    'This is the current result today.',
    'The result was reported in 2021.',
  ).includes('stale_source_as_current'));
});

test('overclaim audit uses the exact cited span rather than unrelated neighboring context', () => {
  const audit = buildClaimSupportAudit({
    claims: [{
      claim: 'The method improves outcomes.',
      source_ids: ['SOURCE 1'],
      evidence_quote: 'The method improves outcomes.',
      supported: true,
    }],
    evidenceEvaluations: [{ ok: true, mode: 'exact_quote', reason: 'exact cited span supports claim' }],
    evidenceQuoteVerified: [true],
    evidenceQuotes: ['The method improves outcomes.'],
    evidenceContexts: [
      'The method improves outcomes. A separate experimental feature may reduce latency.',
    ],
  });

  assert.deepEqual(audit.records[0].overclaimTypes, []);
  assert.equal(audit.records[0].claimSourceVerdict, 'supported');
});

test('live benchmark extracts claim support audits from validator diagnostics', () => {
  const audit = buildClaimSupportAudit({
    claims: [{ claim: 'The game launched in 2011.', source_ids: ['SOURCE 1'], evidence_quote: 'The game launched in 2011.', supported: true }],
    evidenceEvaluations: [{ ok: true, mode: 'exact_quote', reason: 'exact quote' }],
    evidenceQuoteVerified: [true],
    evidenceContexts: ['The game launched in 2011.'],
  });
  const extracted = extractClaimSupportAudit({
    validatorResults: [{ validationDiagnostics: { claimSupport: audit } }],
  });
  assert.equal(extracted.totalClaims, 1);
  assert.equal(extracted.claimSupportPassRate, 1);
  assert.equal(extracted.verdictCounts.entailed, 1);
});

test('aggregate metric preserves per-claim verdicts and overclaim diagnostics', () => {
  const one = buildClaimSupportAudit({
    claims: [
      { claim: 'The system always works.', source_ids: ['SOURCE 1'], evidence_quote: 'The system may work.', supported: true },
      { claim: 'A supported claim.', source_ids: ['SOURCE 2'], evidence_quote: 'A supported claim.', supported: true },
    ],
    evidenceEvaluations: [
      { ok: true, mode: 'exact_quote', reason: 'locally supported' },
      { ok: true, mode: 'exact_quote', reason: 'locally supported' },
    ],
    evidenceQuoteVerified: [true, true],
    evidenceContexts: ['The system may work.', 'A supported claim.'],
  });
  const aggregate = summarizeClaimSupportAudits([one]);

  assert.equal(aggregate.totalClaims, 2);
  assert.equal(aggregate.claimSupportPassRate, 0.5);
  assert.equal(aggregate.verdictCounts.unsupported, 1);
  assert.equal(aggregate.records.length, 2);
  assert.equal(aggregate.overclaimCounts.hedge_to_absolute, 1);
  assert.equal(aggregate.claimSourceVerdictCounts.unsupported_by_cited_source, 1);
});
