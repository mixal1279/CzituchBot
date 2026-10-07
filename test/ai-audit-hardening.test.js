'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchSecondaryProviders } = require('../ai/webRetrieval');
const { czyWymagaSecondaryRetrieval } = require('../ai/tavily');
const { normalizujWynikWalidatora } = require('../ai/validator');
const { wyodrebnijJednostkoweWartosci } = require('../ai/claimValidation');
const { decomposeQuestion, sourceDiversity, shouldRunAdditionalRetrieval } = require('../ai/retrieval');
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


test('compound lore question is decomposed into independent clauses without cumulative duplication', () => {
  const question = "Jaki był związek Johnny'ego Silverhanda z Alt Cunningham i jak wpłynęło to na jego konflikt z Arasaką?";
  const parts = decomposeQuestion(question, {
    game: 'Cyberpunk 2077',
    resolved_entity: { name: 'Johnny Silverhand', game: 'Cyberpunk 2077' },
  });
  assert.equal(parts.length, 2);
  assert.match(parts[0], /Johnny.*Silverhand/i);
  assert.match(parts[0], /Alt Cunningham/i);
  assert.match(parts[1], /Johnny.*Silverhand/i);
  assert.match(parts[1], /Arasak/i);
  assert.doesNotMatch(parts[1], /związek Johnny.*Alt Cunningham.*jak wpłynęło/i);
  assert.match(parts[1], /Alt Cunningham/i);
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
  assert.deepEqual(sourceDiversity(results), { hosts: 2, providers: 1, independentSources: 2, independentHosts: 2, duplicatePairs: 0 });
  assert.equal(shouldRunAdditionalRetrieval({ text: 'x'.repeat(1200), sourceCount: 2, queryCount: 1, results, requireDiversity: true }), false);
});

test('validator accepts a genuine paraphrased claim without weakening source binding', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Portal 2\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\nWheatley zostaje przeniesiony do ciała GLaDOS.\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'potwierdzone', unsupported_claims: [],
    supported: true, relevant: true, complete: true, hallucination: false, confidence: 0.95,
    claims: [{ claim: 'Wheatley trafia do ciała GLaDOS.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Wheatley zostaje przeniesiony do ciała GLaDOS.' }],
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


test('validator treats a positive result without claims as inconclusive', () => {
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'odpowiedź jest w pełni poparta źródłami', unsupported_claims: [],
    supported: true, relevant: true, complete: true, hallucination: false, confidence: 1,
    claims: [],
  }, 'test-model', 'test', new Set(['SOURCE 1']), '[SOURCE 1]\nTREŚĆ: potwierdzony fakt');
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.ok, false);
});

test('validator rejects a matching number expressed in a different unit', () => {
  const data = '[SOURCE 1]\nTYTUŁ: czas gry\nTREŚĆ: Ukończenie gry zajmuje 24 godziny.';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'ok', unsupported_claims: [], supported: true, relevant: true,
    complete: true, hallucination: false, confidence: 0.99,
    claims: [{ claim: 'Ukończenie gry zajmuje 24 minuty.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Ukończenie gry zajmuje 24 godziny.' }],
  }, 'test', 'test', new Set(['SOURCE 1']), data);
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /jednostkami/);
});

test('validator accepts a natural Polish inflection when claims fully ground the sentence', () => {
  const data = '[SOURCE 1]\nTYTUŁ: Portal 2\nTREŚĆ: Wheatley zostaje przeniesiony do ciała GLaDOS i dzięki temu uzyskuje kontrolę nad systemem Aperture.';
  const answer = 'Wheatley trafił do GLaDOS i zdobył kontrolę nad Aperture.';
  const result = normalizujWynikWalidatora({
    valid: true, reason: 'potwierdzone', unsupported_claims: [], supported: true,
    relevant: true, complete: true, hallucination: false, confidence: 0.96,
    claims: [{ claim: 'Wheatley trafia do ciała GLaDOS i uzyskuje kontrolę nad Aperture.', supported: true, source_ids: ['SOURCE 1'], evidence_quote: 'Wheatley zostaje przeniesiony do ciała GLaDOS i dzięki temu uzyskuje kontrolę nad systemem Aperture.' }],
  }, 'test', 'test', new Set(['SOURCE 1']), data, answer);
  assert.equal(result.status, 'accepted');
  assert.equal(result.diagnostics.answerCoverage.ok, true);
  assert.equal(result.diagnostics.answerCoverage.checkedSentences, 1);
});

test('short compact characters are not misread as measurement units', () => {
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Tekst ma 10m i 10sztuk, wartość 10c.'), []);
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Dystans to 10 m, a czas to 10 s.'), ['10:m', '10:second']);
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Temperatura wynosi 10 °C.'), ['10:celsius']);
});

test('retrieval asks for more evidence when different hosts syndicate the same text', () => {
  const copied = 'Wheatley takes control of GLaDOS after the core transfer into her body and gains access to the Aperture systems in Portal 2.';
  const results = [
    { score: 0.9, url: 'https://site-one.example/story', provider: 'tavily', title: 'Portal 2 story', content: copied },
    { score: 0.85, url: 'https://site-two.example/copy', provider: 'exa', title: 'Portal 2 story copy', content: copied },
  ];
  assert.equal(sourceDiversity(results).hosts, 2);
  assert.equal(sourceDiversity(results).independentHosts, 1);
  assert.equal(shouldRunAdditionalRetrieval({ status: 'ok', text: 'x'.repeat(1200), sourceCount: 2, results, requireDiversity: true }), true);
});

test('www and apex variants count as one source host', () => {
  const diversity = sourceDiversity([
    { url: 'https://www.example.com/a', provider: 'tavily' },
    { url: 'https://example.com/b', provider: 'exa' },
  ]);
  assert.equal(diversity.hosts, 1);
  assert.equal(diversity.independentHosts, 1);
});
