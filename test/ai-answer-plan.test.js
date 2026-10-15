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

test('answer signals distinguish procedure from mechanism explanations', () => {
  const procedural = extractAnswerSignals('Najpierw wykonaj czynność, a następnie sprawdź wynik.');
  const mechanism = extractAnswerSignals('System działa dzięki wymianie rdzeni.');
  const generic = extractAnswerSignals('Znajdziesz to w odpowiednim miejscu.');
  assert.equal(generic.where, false);
  assert.equal(procedural.steps, true);
  assert.equal(procedural.how, false);
  assert.equal(mechanism.how, true);
});

test('answer plan does not mistake how-long questions for procedural how questions', () => {
  const plan = buildAnswerPlan('Jak długo trwa główna fabuła Skyrim?');
  assert.ok(plan.requirements.some(x => x.id === 'quantity'));
  assert.ok(!plan.requirements.some(x => x.id === 'how'));
  assert.ok(!plan.requirements.some(x => x.id === 'steps'));
});

test('answer plan classifies how-to combat questions as procedural', () => {
  const plan = buildAnswerPlan('Jak pokonać smoka w Skyrim?', { intent: 'web_fact', is_gameplay: true });
  assert.ok(plan.requirements.some(x => x.id === 'steps'));
  assert.ok(!plan.requirements.some(x => x.id === 'how'));
});

test('v26 judge rejects generic relationship answer', () => {
  const plan = buildAnswerPlan('Jaka jest relacja Geralta i Yennefer?', {
    intent:'web_fact', is_lore:true, entity:'Geralt', game:'The Witcher 3',
  });
  const result = judgeAnswer('Ich relacja jest złożona.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('relationship'));
});
