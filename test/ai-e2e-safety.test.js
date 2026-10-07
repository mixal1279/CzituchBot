'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAIRequest } = require('../ai/router');
const { planAIRequest, buildRetrievalQueries } = require('../ai/planner');
const { buildAdvancedRetrievalPlan, shouldRunAdditionalRetrieval, sourceDiversity } = require('../ai/retrieval');
const { resolveGameEntity } = require('../ai/entities');
const { normalizujWynikWalidatora } = require('../ai/validator');

test('AI E2E contract: route -> plan -> retrieval -> generation -> claim validation', () => {
  const question = 'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?';

  // Policy jest deterministyczny w tym teście; nie wywołujemy żadnego modelu ani sieci.
  const routing = classifyAIRequest(question, () => 'conversation');
  assert.equal(routing.is_lore, true);
  assert.equal(routing.game, 'Portal 2');
  assert.equal(routing.resolved_entity?.name, 'Wheatley');

  const plan = planAIRequest(question, routing);
  assert.equal(plan.responseProfile, 'lore');
  assert.equal(plan.sourcePolicy.requireEvidence, true);
  assert.ok(plan.retrievalQueries.length > 0);

  const advanced = buildAdvancedRetrievalPlan(question, routing, plan.retrievalQueries);
  assert.ok(advanced.length > 0);
  assert.ok(advanced.some(item => item.reason === 'lore'));

  // Zastępujemy zewnętrzny retrieval deterministycznym fixture'em.
  const sources = [
    {
      score: 0.91,
      authority: 'wyspecjalizowane',
      provider: 'tavily',
      url: 'https://minecraft.wiki/example-portal',
      content: 'Portal 2: Wheatley przejmuje kontrolę nad GLaDOS po transferze rdzeni i zamianie ciał.',
    },
    {
      score: 0.86,
      authority: 'guide/referencyjne',
      provider: 'tavily',
      url: 'https://example.org/portal-2-lore',
      content: 'Wheatley trafia do ciała GLaDOS, uzyskując kontrolę nad systemem Aperture.',
    },
  ];

  assert.deepEqual(sourceDiversity(sources), { hosts: 2, providers: 1 });
  assert.equal(
    shouldRunAdditionalRetrieval({
      status: 'ok',
      text: 'x'.repeat(1200),
      sourceCount: sources.length,
      results: sources,
      requireDiversity: true,
    }),
    false,
  );

  const referenceData = sources.map((source, index) =>
    [
      `[SOURCE ${index + 1}]`,
      `TYTUŁ: Portal 2 — źródło ${index + 1}`,
      `TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>`,
      source.content,
      '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
    ].join('\n')
  ).join('\n---\n');

  // Symulowany generator zwraca odpowiedź, a validator ocenia ją na podstawie
  // dokładnie tych samych źródeł, które dostał generator.
  const generatedAnswer = 'Wheatley przejął kontrolę nad GLaDOS po transferze rdzeni i zamianie ciał.';
  const validatorPayload = {
    valid: true,
    reason: 'Twierdzenie jest potwierdzone przez źródła.',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence: 0.95,
    claims: [{
      claim: generatedAnswer,
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Wheatley przejmuje kontrolę nad GLaDOS po transferze rdzeni i zamianie ciał.',
    }],
  };

  const validated = normalizujWynikWalidatora(
    validatorPayload,
    'test-model',
    'test',
    new Set(['SOURCE 1', 'SOURCE 2']),
    referenceData,
  );

  assert.equal(validated.status, 'accepted');
  assert.equal(validated.ok, true);
});

test('entity resolver remains deterministic for a character plus its game', () => {
  const resolved = resolveGameEntity('Co Wheatley robi w Portal 2?');
  assert.equal(resolved?.type, 'character');
  assert.equal(resolved?.name, 'Wheatley');
  assert.equal(resolved?.game, 'Portal 2');
});

test('planner preserves all major query components for compound lore questions', () => {
  const question = 'Co zrobił Wheatley i dlaczego przejął kontrolę nad GLaDOS w Portal 2?';
  const routing = classifyAIRequest(question, () => 'conversation');
  const queries = buildRetrievalQueries(question, routing, { maxQueries: 4 });

  assert.ok(queries.length >= 2);
  assert.ok(queries.some(q => /Wheatley/i.test(q)));
  assert.ok(queries.some(q => /GLaDOS/i.test(q)));
  assert.ok(queries.some(q => /Portal 2/i.test(q)));
});
