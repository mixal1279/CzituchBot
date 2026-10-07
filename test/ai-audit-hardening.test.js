'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchSecondaryProviders } = require('../ai/webRetrieval');
const { czyWymagaSecondaryRetrieval } = require('../ai/tavily');
const { normalizujWynikWalidatora } = require('../ai/validator');
const { sourceDiversity, shouldRunAdditionalRetrieval } = require('../ai/retrieval');
const { createAIRequestContext } = require('../ai/requestContext');
const { createAIMetrics, recordAIMetric, snapshotAIMetrics } = require('../ai/metrics');

test('secondary provider receives the remaining timeout', async () => {
  let observedSignal = false;
  const fakeFetch = async (_url, options) => {
    observedSignal = Boolean(options?.signal);
    return new Response(JSON.stringify({ results: [{ title: 'Exa', url: 'https://example.com/a', highlights: ['evidence'] }] }), { status: 200 });
  };
  const result = await searchSecondaryProviders({ query: 'q', exaKey: 'x', fetchFn: fakeFetch, prefer: 'exa', timeoutMs: 1234 });
  assert.equal(result.status, 'ok');
  assert.equal(observedSignal, true);
});

test('two weak Tavily results from one host do not count as sufficient evidence', () => {
  assert.equal(czyWymagaSecondaryRetrieval([
    { score: 0.3, url: 'https://example.com/a' },
    { score: 0.4, url: 'https://example.com/b' },
  ], 'dlaczego coś się wydarzyło', null), true);
});

test('strong multi-host retrieval can finish without secondary provider', () => {
  assert.equal(czyWymagaSecondaryRetrieval([
    { score: 0.9, url: 'https://minecraft.wiki/a' },
    { score: 0.8, url: 'https://example.org/b' },
  ], 'Minecraft receptura', null), false);
});

test('retrieval diversity is part of the sufficiency decision', () => {
  const results = [
    { score: 0.9, url: 'https://one.example/a', provider: 'tavily' },
    { score: 0.8, url: 'https://two.example/b', provider: 'tavily' },
  ];
  assert.deepEqual(sourceDiversity(results), { hosts: 2, providers: 1 });
  assert.equal(shouldRunAdditionalRetrieval({ text: 'x'.repeat(1200), sourceCount: 2, queryCount: 1, results, requireDiversity: true }), false);
});

test('validator accepts a genuine paraphrased evidence quote without weakening source binding', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Portal 2\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nWheatley zostaje przeniesiony do ciała GLaDOS.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'potwierdzone', unsupported_claims: [],
    supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.95,
    claims: [{ claim: 'Wheatley trafia do ciała GLaDOS.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Wheatley zostaje umieszczony w ciele GLaDOS.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'accepted');
});

test('validator rejects a fabricated source id even when the claim is marked supported', () => {
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [],
    supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.99,
    claims: [{ claim: 'Fakt', supported: true, source_ids: ['SOURCE 99'], evidence_quote: 'Fakt' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), '[SOURCE 1]\nTYTUŁ: x\nTREŚĆ: Fakt');
  assert.equal(result.status, 'rejected');
});

test('request context enforces the shared generation budget', () => {
  const ctx = createAIRequestContext({ maxGeneracji: 1, maxModelCalls: 1, maxCzasMs: 10000 });
  assert.equal(ctx.reserveGeneration('test', 'model-a'), true);
  assert.equal(ctx.reserveGeneration('test', 'model-b'), false);
  assert.equal(ctx.generacje, 1);
});

test('AI metrics expose retry and supplemental retrieval outcomes', () => {
  const metrics = createAIMetrics();
  recordAIMetric(metrics, { status: 'accepted', retry: true, retryAccepted: true, supplementalRetrieval: true, supplementalSuccess: true, sourceDiversityFailure: true });
  const snapshot = snapshotAIMetrics(metrics);
  assert.equal(snapshot.retries, 1);
  assert.equal(snapshot.retryAccepted, 1);
  assert.equal(snapshot.supplementalSuccesses, 1);
  assert.equal(snapshot.sourceDiversityFailures, 1);
});

test('validator rejects a causal claim when the evidence only supports the event', () => {
  const data = '[SOURCE 1]\nTYTUŁ: RDR2\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nArthur zdradził Dutcha podczas wydarzeń w obozie.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.99,
    claims: [{ claim: 'Arthur zdradził Dutcha, ponieważ chciał uratować Johna.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Arthur zdradził Dutcha podczas wydarzeń w obozie.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'rejected');
});

test('validator rejects a claim with a mismatching year', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Gra\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nGra została wydana w 2020 roku.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.99,
    claims: [{ claim: 'Gra została wydana w 2021 roku.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Gra została wydana w 2020 roku.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'rejected');
});

test('validator accepts paraphrase when entities, relation and facts remain aligned', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Portal 2\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nWheatley zostaje przeniesiony do ciała GLaDOS i dzięki temu uzyskuje kontrolę nad systemem Aperture.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.95,
    claims: [{ claim: 'Wheatley trafia do ciała GLaDOS i uzyskuje kontrolę nad Aperture.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Wheatley zostaje przeniesiony do ciała GLaDOS i dzięki temu uzyskuje kontrolę nad systemem Aperture.' }],
  }, 'test-model', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'accepted');
});
