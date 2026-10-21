'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnswerPlan, extractAnswerSignals, assessAnswerCompleteness } = require('../ai/answer-plan');
const { buildRetrievalQueries, responseContract } = require('../ai/planner');
const { judgeAnswer, partialAnswerPreservesCoreIntent } = require('../ai/answer-judge');

test('partial answers may omit game context but must preserve the core question intent', () => {
  assert.equal(partialAnswerPreservesCoreIntent({
    status: 'repair',
    missing: ['entity_context'],
  }), true);
  assert.equal(partialAnswerPreservesCoreIntent({
    status: 'repair',
    missing: ['why', 'causal_explanation'],
  }), false);
  assert.equal(partialAnswerPreservesCoreIntent({
    status: 'repair',
    missing: ['steps', 'entity_context'],
  }), false);
  assert.equal(partialAnswerPreservesCoreIntent({
    status: 'rejected',
    missing: [],
  }), false);
});

test('v26 answer plan identifies causal lore requirements', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2',
  });
  assert.ok(plan.requirements.some(x => x.id === 'why'));
  assert.ok(plan.requirements.some(x => x.id === 'causal_explanation'));
  assert.ok(plan.requirements.some(x => x.id === 'entity_context'));
  assert.match(plan.instruction, /jawnie podaje motyw lub cel działania/);
  assert.match(plan.instruction, /nie zastępuj go domniemaną przyczyną/);
});

test('a stated motive phrased as "miało na celu" satisfies a why answer plan', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2',
  });
  const answer = 'Wheatley przeniósł rdzeń GLaDOS do układu z baterią ziemniaczaną, co miało na celu upokorzenie jej.';
  const result = judgeAnswer(answer, plan);
  assert.equal(result.status, 'accepted', JSON.stringify(result));
  assert.deepEqual(result.missing, []);
});

test('who-answer guidance prioritizes the source-defined identity over secondary traits', () => {
  const plan = buildAnswerPlan('Kim jest Astarion?', {
    intent:'web_fact', entity:'Astarion', game:"Baldur's Gate 3",
  });
  assert.match(plan.instruction, /głównej tożsamości lub typu postaci/);
  assert.match(plan.instruction, /nie mogą zastąpić głównej tożsamości/);
});

test('v26 answer plan detects and enforces coverage for multiple clauses', () => {
  const plan = buildAnswerPlan(
    'Dlaczego Wheatley przejął kontrolę nad GLaDOS i co doprowadziło do jego porażki?',
    { intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2' },
  );
  assert.equal(plan.clauses.length, 2);
  assert.equal(plan.complexity, 'high');
  assert.ok(plan.requirements.some(x => x.id === 'clause_coverage'));

  const incomplete = judgeAnswer(
    'Wheatley przejął kontrolę nad GLaDOS, ponieważ został umieszczony w jej systemie.',
    plan,
  );
  assert.equal(incomplete.status, 'repair');
  assert.ok(incomplete.missing.includes('clause_coverage'));

  const complete = judgeAnswer(
    'Wheatley przejął kontrolę nad GLaDOS, ponieważ został umieszczony w jej systemie. Jego porażkę spowodowała walka z Chell.',
    plan,
  );
  assert.equal(complete.status, 'accepted', JSON.stringify(complete));
});

test('v26 judge detects grounded but incomplete causal answer', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent:'web_fact', is_lore:true, entity:'Wheatley', game:'Portal 2',
  });
  const result = judgeAnswer('Wheatley przejął kontrolę nad GLaDOS w Portal 2.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('causal_explanation'));
});

test('high-score answer is still repaired when one mandatory slot is missing', () => {
  const plan = {
    complexity: 'high',
    requirements: [
      { id: 'entity_context', required: true },
      { id: 'why', required: true },
      { id: 'causal_explanation', required: true },
      { id: 'relationship', required: true },
    ],
  };
  const answer = 'Wheatley przejął kontrolę, ponieważ wykorzystał wymianę rdzeni.';
  const result = judgeAnswer(answer, plan);
  assert.equal(result.score, 0.75);
  assert.equal(result.status, 'repair');
  assert.deepEqual(result.missing, ['relationship']);
  assert.match(result.reason, /relationship/);
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

test('answer completeness requires the planned entity and avoids purpose/location false positives', () => {
  const plan = buildAnswerPlan('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent: 'web_fact', is_lore: true, entity: 'Wheatley', game: 'Portal 2',
  });
  const unrelated = assessAnswerCompleteness('System zadziałał z powodu awarii.', plan);
  assert.ok(unrelated.missing.includes('entity_context'));
  const grounded = assessAnswerCompleteness('Wheatley przejął kontrolę z powodu awarii systemu.', plan);
  assert.ok(!grounded.missing.includes('entity_context'));

  const purpose = extractAnswerSignals('Wheatley przejął kontrolę, aby uciec z laboratorium.');
  assert.equal(purpose.why, true);
  assert.equal(purpose.causal_explanation, true);
  assert.equal(purpose.steps, false);

  const statedPurpose = extractAnswerSignals('Wheatley przeniósł rdzeń, co miało na celu upokorzenie GLaDOS.');
  assert.equal(statedPurpose.why, true);
  assert.equal(statedPurpose.causal_explanation, true);
  assert.equal(extractAnswerSignals('Z powodu awarii system przestał działać.').where, false);
  assert.equal(extractAnswerSignals('Cena wynosi 100 zł.').quantity, true);
});

test('answer signals recognize procedural and mechanism explanations', () => {
  const procedural = extractAnswerSignals('Najpierw wykonaj czynność, a następnie sprawdź wynik.');
  const mechanism = extractAnswerSignals('System działa dzięki wymianie rdzeni.');
  const generic = extractAnswerSignals('Znajdziesz to w odpowiednim miejscu.');
  assert.equal(generic.where, false);
  assert.equal(procedural.steps, true);
  assert.equal(procedural.how, true);
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
  assert.ok(plan.requirements.some(x => x.id === 'how'));
});

test('location-only gameplay exemption recognizes inflected procedure terms', () => {
  for (const question of [
    'Gdzie znaleźć bossa w Elden Ring?',
    'Gdzie znaleźć questy w Skyrim?',
    'Gdzie są misje poboczne?',
    'Gdzie szukać poradnika do gry?',
    'Gdzie znaleźć solucję do questa?',
  ]) {
    const plan = buildAnswerPlan(question, { intent: 'web_fact', is_gameplay: true });
    assert.ok(plan.requirements.some(x => x.id === 'steps'), question);
  }

  const locationOnly = buildAnswerPlan('Gdzie znaleźć Wielki Miecz?', {
    intent: 'web_fact', is_gameplay: true,
  });
  assert.ok(!locationOnly.requirements.some(x => x.id === 'steps'));
});

test('v26 judge rejects generic relationship answer', () => {
  const plan = buildAnswerPlan('Jaka jest relacja Geralta i Yennefer?', {
    intent:'web_fact', is_lore:true, entity:'Geralt', game:'The Witcher 3',
  });
  const result = judgeAnswer('Ich relacja jest złożona.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('relationship'));
});


test('response contract forbids redundant source narration that creates uncovered sentences', () => {
  const contract = responseContract('lore');
  assert.match(contract, /Nie dodawaj metakomentarzy.*źródło potwierdza/s);
  assert.match(contract, /nie dopisuj końcowego podsumowania/s);
});

test('retrieval planner adds location-specific queries for landmark answers', () => {
  const queries = buildRetrievalQueries('Gdzie znaleźć Wielki Miecz?', {
    intent: 'web_fact', entity: 'Greatsword', game: 'Elden Ring', needs_web: true,
  });
  assert.ok(queries.some(q => /exact location landmark nearby map/i.test(q)), JSON.stringify(queries));
  assert.ok(queries.some(q => /Elden Ring/i.test(q)), JSON.stringify(queries));
});

test('retrieval planner adds timeline and quest-order queries for when questions', () => {
  const queries = buildRetrievalQueries('Kiedy Geralt przybywa do Novigradu?', {
    intent: 'web_fact', entity: 'Geralt', game: 'The Witcher 3', needs_web: true,
  });
  assert.ok(queries.some(q => /story timeline quest order arrival/i.test(q)), JSON.stringify(queries));
});

test('retrieval planner targets character identity for who questions', () => {
  const queries = buildRetrievalQueries('Kim jest Astarion?', {
    intent: 'web_fact', is_lore: true, entity: 'Astarion', game: "Baldur's Gate 3", needs_web: true,
  });
  assert.ok(queries.some(q => /character identity background role companion/i.test(q)), JSON.stringify(queries));
});

test('retrieval planner targets cause and motivation for why questions', () => {
  const queries = buildRetrievalQueries('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent: 'web_fact', is_lore: true, entity: 'Wheatley', game: 'Portal 2', needs_web: true,
  });
  assert.ok(queries.some(q => /cause reason motivation event core transfer/i.test(q)), JSON.stringify(queries));
});
