'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsujStrukturalnePodsumowanie } = require('../ai/history');
const { scoreExternalGameCandidate } = require('../ai/entities');
const { createAIRequestContext } = require('../ai/requestContext');
const { createAIMetrics, recordAIMetric, snapshotAIMetrics } = require('../ai/metrics');
const { sprawdzTwardeFaktyOdpowiedzi } = require('../ai/response');

test('structured history keeps entities, decisions and open questions', () => {
  const summary = parsujStrukturalnePodsumowanie(JSON.stringify({
    entities: ['Portal 2', 'Wheatley'],
    preferences: ['odpowiedzi po polsku'],
    decisions: ['używać GameLore do lore'],
    open_questions: ['czy źródła są wystarczająco różnorodne?'],
    recent_context: 'Test pipeline AI.',
  }));
  assert.match(summary, /Portal 2/);
  assert.match(summary, /Ustalenia:/);
  assert.match(summary, /Otwarte pytania:/);
});

test('external entity scoring rejects weak unrelated game names', () => {
  assert.equal(scoreExternalGameCandidate('Red Dead Redemption 2', 'Red Dead Redemption 2'), 1);
  assert.ok(scoreExternalGameCandidate('Cyberpunk 2077', 'Cyberpunk 2077 Ultimate Edition') >= 0.82);
  assert.ok(scoreExternalGameCandidate('Portal 2', 'Minecraft') < 0.72);
});

test('worst-case request budget cannot exceed configured model, generation, validator and Tavily limits', () => {
  const ctx = createAIRequestContext({
    maxCzasMs: 60000,
    maxGeneracji: 6,
    maxModelCalls: 10,
    maxValidatorow: 3,
    maxWyszukanTavily: 2,
  });
  for (let i = 0; i < 10; i++) assert.equal(ctx.reserveModel('worst-case'), true);
  assert.equal(ctx.reserveModel('overflow'), false);

  const generationCtx = createAIRequestContext({ maxCzasMs: 60000, maxGeneracji: 6, maxModelCalls: 10, maxValidatorow: 3, maxWyszukanTavily: 2 });
  for (let i = 0; i < 6; i++) assert.equal(generationCtx.reserveGeneration('test', 'model'), true);
  assert.equal(generationCtx.reserveGeneration('overflow', 'model'), false);

  const validatorCtx = createAIRequestContext({ maxCzasMs: 60000, maxGeneracji: 6, maxModelCalls: 10, maxValidatorow: 3, maxWyszukanTavily: 2 });
  for (let i = 0; i < 3; i++) assert.equal(validatorCtx.reserveValidator('validator'), true);
  assert.equal(validatorCtx.reserveValidator('overflow'), false);

  const tavilyCtx = createAIRequestContext({ maxCzasMs: 60000, maxGeneracji: 6, maxModelCalls: 10, maxValidatorow: 3, maxWyszukanTavily: 2 });
  for (let i = 0; i < 2; i++) assert.equal(tavilyCtx.reserveTavily('retrieval'), true);
  assert.equal(tavilyCtx.reserveTavily('overflow'), false);
});

test('hard-fact response guard canonicalizes equivalent decimal formatting', () => {
  const evidence = 'Cena wynosi 2.50 kg.';
  const equivalent = sprawdzTwardeFaktyOdpowiedzi('Cena wynosi 2,5 kg.', evidence);
  assert.equal(equivalent.ok, true, JSON.stringify(equivalent.unsupported));
  const mismatch = sprawdzTwardeFaktyOdpowiedzi('Cena wynosi 2,6 kg.', evidence);
  assert.equal(mismatch.ok, false);

  const metadataOnly = sprawdzTwardeFaktyOdpowiedzi(
    'Wydarzenie miało miejsce w 2011 roku.',
    [
      '[SOURCE 1]',
      'TYTUŁ: Wydarzenie 2011',
      'URL: https://example.com/2011',
      'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
      'Brak daty w treści źródła.',
      '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
    ].join('\n'),
  );
  assert.equal(metadataOnly.ok, false, 'dates in source titles/URLs must not count as evidence');
});

test('quality metrics expose coverage and answer-quality aggregates', () => {
  const metrics = createAIMetrics();
  recordAIMetric(metrics, {
    status: 'accepted',
    claimCoverage: 1,
    answerQuality: 0.92,
  });
  recordAIMetric(metrics, {
    status: 'rejected',
    claimCoverage: 0.25,
    answerQuality: 0.2,
  });
  const snapshot = snapshotAIMetrics(metrics);
  assert.equal(snapshot.avgClaimCoverage, 0.625);
  assert.equal(snapshot.avgAnswerQuality, 0.56);
  assert.equal(snapshot.falseAccepts, 0);
  assert.equal(snapshot.falseRejects, 0);
});
