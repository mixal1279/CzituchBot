'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnswerPlan, extractAnswerSignals } = require('../ai/answer-plan');
const { judgeAnswer } = require('../ai/answer-judge');

test('v26 answer plan identifies causal lore requirements', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2',
  });
  assert.ok(plan.requirements.some(x => x.id === 'why'));
  assert.ok(plan.requirements.some(x => x.id === 'causal_explanation'));
  assert.ok(plan.requirements.some(x => x.id === 'entity_context'));
});

test('v26 answer plan detects multiple clauses', () => {
  const plan = buildAnswerPlan(
    'Dlaczego Wheatley przejął kontrolę nad GLaDOS i co doprowadziło do jego porażki?',
    { intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2' },
  );
  assert.equal(plan.clauses.length, 2);
  assert.equal(plan.complexity, 'high');
});

test('v26 judge detects grounded but incomplete causal answer', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2',
  });
  const result = judgeAnswer('Wheatley przejął kontrolę nad GLaDOS w Portal 2.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('causal_explanation'));
});

test('v26 judge accepts complete causal answer', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2',
  });
  const result = judgeAnswer(
    'Wheatley przejął kontrolę nad GLaDOS, ponieważ podczas wymiany rdzeni został umieszczony w jej systemie, a następnie wykorzystał swoją pozycję, by przejąć kontrolę.',
    plan,
  );
  assert.equal(result.status, 'accepted');
});

test('v26 judge rejects generic why answer', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2',
  });
  const result = judgeAnswer('Powodem była konkretna sytuacja.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('causal_explanation'));
});

test('answer signals handle Polish ł normalization and inflected answer roots', () => {
  assert.equal(extractAnswerSignals('Arthur Morgan był członkiem gangu.').who, true);
  assert.equal(extractAnswerSignals('W wyniku walki bohater zginął na miejscu.').outcome, true);
  assert.equal(extractAnswerSignals('Po tym wydarzeniu bohater został sam.').outcome, true);
  assert.equal(extractAnswerSignals('Ich relacja opierała się na wieloletniej współpracy.').relationship, true);
  assert.equal(extractAnswerSignals('Ten pistolet jest lepszy natomiast tamten ma większą celność.').comparison, true);
});

test('v26 answer signals reject generic where and procedural answers', () => {
  const signals = extractAnswerSignals('Znajdziesz to w odpowiednim miejscu. Najpierw wykonaj czynność.');
  assert.equal(signals.where, false);
  assert.equal(signals.how, true);
});

test('v26 judge rejects generic relationship answer', () => {
  const plan = buildAnswerPlan('Jaka jest relacja Geralta i Yennefer?', {
    intent:'web_fact', is_lore:true, entity:'Geralt', game:'The Witcher 3',
  });
  const result = judgeAnswer('Ich relacja jest złożona.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('relationship'));
});
