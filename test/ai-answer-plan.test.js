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

test('v26 accepts an explicit variable duration instead of forcing a fabricated number', () => {
  const plan = buildAnswerPlan('Ile trwa walka z Malenią?', {
    intent: 'web_fact', is_lore: true, entity: 'Malenia', game: 'Elden Ring',
  });
  assert.equal(plan.quantityMayBeVariable, true);
  const result = judgeAnswer(
    'Nie ma stałego czasu; zależy od umiejętności gracza, buildu i strategii.',
    plan,
  );
  assert.equal(result.status, 'accepted');
});

test('v26 recognizes a direct outcome statement about a character death', () => {
  const plan = buildAnswerPlan('Co stało się z Vesemir?', {
    intent: 'web_fact', is_lore: true, entity: 'Vesemir', game: 'The Witcher 3',
  });
  const result = judgeAnswer(
    'Vesemir zostaje zabity przez Imleritha podczas bitwy o Kaer Morhen.',
    plan,
  );
  assert.equal(result.status, 'accepted');
});

test('v26 recognizes companion relationships and direct gameplay instructions', () => {
  const relationshipPlan = buildAnswerPlan('Jaka jest relacja między Astarion a Gale?', {
    intent: 'web_fact', is_lore: true, entity: 'Astarion', game: "Baldur's Gate 3",
  });
  assert.equal(judgeAnswer(
    'Astarion i Gale są towarzyszami w drużynie; ich relacja zależy od wyborów gracza.',
    relationshipPlan,
  ).status, 'accepted');

  const gameplayPlan = buildAnswerPlan('Jak pokonać smoka?', {
    intent: 'web_fact', is_gameplay: true, game: 'Skyrim',
  });
  assert.equal(judgeAnswer(
    'Użyj Smoczego Zguby, a następnie atakuj smoka, gdy wyląduje.',
    gameplayPlan,
  ).status, 'accepted');
});

test('v26 accepts relative story chronology for when questions', () => {
  const plan = buildAnswerPlan('Kiedy Geralt przybywa do Novigradu?', {
    intent: 'web_fact', is_lore: true, entity: 'Geralt', game: 'The Witcher 3',
  });
  assert.equal(judgeAnswer(
    'Geralt przybywa do Novigradu po wydarzeniach w Velen.',
    plan,
  ).status, 'accepted');
});

test('v26 judge never accepts a partial answer just because its average score meets the threshold', () => {
  const plan = buildAnswerPlan('Kiedy i gdzie Geralt przybywa do Novigradu?', {
    intent: 'web_fact', is_lore: true, entity: 'Geralt', game: 'The Witcher 3',
  });
  const result = judgeAnswer('Geralt przybywa do Novigradu w 1272 roku.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('where'));
});
