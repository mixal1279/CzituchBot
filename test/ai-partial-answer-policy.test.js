'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizujWynikWalidatora } = require('../ai/validator');

const source = '[SOURCE 1]\nTYTUŁ: Wiedźmin — notatki\nTREŚĆ: Geralt jest wiedźminem z Kaer Morhen. Yennefer jest czarodziejką z Vengerbergu.';

function withPartialAnswersEnabled(fn) {
  const previous = process.env.AI_ALLOW_PARTIAL_ANSWERS;
  process.env.AI_ALLOW_PARTIAL_ANSWERS = '1';
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AI_ALLOW_PARTIAL_ANSWERS;
    else process.env.AI_ALLOW_PARTIAL_ANSWERS = previous;
  }
}

function result(claims, answer, confidence = 0.96) {
  return normalizujWynikWalidatora({
    valid: true,
    reason: 'ok',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence,
    claims,
  }, 'test-model', 'test', new Set(['SOURCE 1']), source, answer);
}

test('partial answer keeps only locally verified claims when another quote is missing', () => {
  const answer = 'Geralt jest wiedźminem z Kaer Morhen. Yennefer jest królową Nilfgaardu.';
  const r = withPartialAnswersEnabled(() => result([
    {
      claim: 'Geralt jest wiedźminem z Kaer Morhen.',
      claim_en: '',
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Geralt jest wiedźminem z Kaer Morhen.',
      reason: 'ok',
    },
    {
      claim: 'Yennefer jest królową Nilfgaardu.',
      claim_en: '',
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Yennefer jest królową Nilfgaardu.',
      reason: 'ok',
    },
  ], answer));

  assert.equal(r.status, 'soft_accepted', JSON.stringify(r.diagnostics));
  assert.match(r.partialAnswer, /Geralt jest wiedźminem z Kaer Morhen/);
  assert.doesNotMatch(r.partialAnswer, /królową Nilfgaardu/);
  assert.match(r.partialAnswer, /Nie wszystkie szczegóły da się potwierdzić/);
});

test('partial answer never includes a claim with an unknown source ID', () => {
  const answer = 'Geralt jest wiedźminem z Kaer Morhen. Yennefer jest królową Nilfgaardu.';
  const r = withPartialAnswersEnabled(() => normalizujWynikWalidatora({
    valid: true,
    reason: 'ok',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence: 0.96,
    claims: [
      {
        claim: 'Geralt jest wiedźminem z Kaer Morhen.',
        supported: true,
        source_ids: ['SOURCE 1'],
        evidence_quote: 'Geralt jest wiedźminem z Kaer Morhen.',
        reason: 'ok',
        claim_en: '',
      },
      {
        claim: 'Yennefer jest czarodziejką.',
        supported: true,
        source_ids: ['SOURCE 99'],
        evidence_quote: 'Yennefer została królową Nilfgaardu po ślubie.',
        reason: 'ok',
        claim_en: '',
      },
    ],
  }, 'test-model', 'test', new Set(['SOURCE 1']), source, answer));

  assert.equal(r.status, 'rejected');
  assert.equal(r.partialAnswer, null);
  assert.ok(r.diagnostics.localRejectReasons.includes('unknown_source_id'));
});


test('partial answers remain opt-in when the environment flag is absent', () => {
  const previous = process.env.AI_ALLOW_PARTIAL_ANSWERS;
  delete process.env.AI_ALLOW_PARTIAL_ANSWERS;
  try {
    const r = result([
      {
        claim: 'Geralt jest wiedźminem z Kaer Morhen.',
        claim_en: '',
        supported: true,
        source_ids: ['SOURCE 1'],
        evidence_quote: 'Geralt jest wiedźminem z Kaer Morhen.',
        reason: 'ok',
      },
      {
        claim: 'Yennefer jest królową Nilfgaardu.',
        claim_en: '',
        supported: true,
        source_ids: ['SOURCE 1'],
        evidence_quote: 'Yennefer jest królową Nilfgaardu.',
        reason: 'ok',
      },
    ], 'Geralt jest wiedźminem z Kaer Morhen. Yennefer jest królową Nilfgaardu.');
    assert.equal(r.status, 'rejected');
    assert.equal(r.partialAnswer, null);
  } finally {
    if (previous === undefined) delete process.env.AI_ALLOW_PARTIAL_ANSWERS;
    else process.env.AI_ALLOW_PARTIAL_ANSWERS = previous;
  }
});

test('partial answer never emits a claim that conflicts with source negation', () => {
  const answer = 'Geralt jest wiedźminem z Kaer Morhen. Geralt nie jest wiedźminem.';
  const r = withPartialAnswersEnabled(() => result([
    {
      claim: 'Geralt jest wiedźminem z Kaer Morhen.',
      claim_en: '',
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Geralt jest wiedźminem z Kaer Morhen.',
      reason: 'ok',
    },
    {
      claim: 'Geralt nie jest wiedźminem.',
      claim_en: '',
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Geralt jest wiedźminem z Kaer Morhen.',
      reason: 'ok',
    },
  ], answer));

  assert.equal(r.status, 'soft_accepted', JSON.stringify(r.diagnostics));
  assert.match(r.partialAnswer, /Geralt jest wiedźminem z Kaer Morhen/);
  assert.doesNotMatch(r.partialAnswer, /nie jest wiedźminem/);
});

test('partial answer does not lower the confidence threshold', () => {
  const answer = 'Geralt jest wiedźminem z Kaer Morhen. Yennefer jest królową Nilfgaardu.';
  const r = withPartialAnswersEnabled(() => result([
    {
      claim: 'Geralt jest wiedźminem z Kaer Morhen.',
      claim_en: '',
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Geralt jest wiedźminem z Kaer Morhen.',
      reason: 'ok',
    },
    {
      claim: 'Yennefer jest królową Nilfgaardu.',
      claim_en: '',
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Yennefer jest królową Nilfgaardu.',
      reason: 'ok',
    },
  ], answer, 0.74));

  assert.equal(r.status, 'rejected');
  assert.equal(r.partialAnswer, null);
  assert.ok(r.diagnostics.localRejectReasons.includes('confidence_below_threshold'));
});
