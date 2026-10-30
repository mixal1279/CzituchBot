'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnswerPlan, extractAnswerSignals, assessAnswerCompleteness } = require('../ai/answer-plan');
const { buildRetrievalQueries, responseContract } = require('../ai/planner');
const { selectRetrievalQueries } = require('../ai/retrieval');
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
  assert.match(plan.instruction, /„designed to be attached” nie dowodzi/);
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

test('procedural guidance forbids generic game advice without retrieved evidence', () => {
  const plan = buildAnswerPlan('Jak pokonać smoka w Skyrim?', {
    intent: 'gameplay', is_gameplay: true, entity: 'dragon', game: 'Skyrim',
  });
  assert.match(plan.instruction, /wyłącznie kroków, które są bezpośrednio potwierdzone/);
  assert.match(plan.instruction, /Nie dopisuj typowych porad z własnej wiedzy/);
  assert.match(plan.instruction, /nie wymyślaj brakujących działań/);
});

test('where-answer guidance requests a named landmark rather than direction alone', () => {
  const plan = buildAnswerPlan('Gdzie znajduje się Wielki Miecz?', {
    intent: 'web_fact', is_gameplay: true, entity: 'Greatsword', game: 'Elden Ring',
  });
  assert.match(plan.instruction, /precyzyjny punkt orientacyjny/);
  assert.match(plan.instruction, /ruiny, budowla lub konkretny obiekt/);
});

test('who-answer guidance prioritizes source-defined identity over secondary traits', () => {
  const plan = buildAnswerPlan('Kim jest Astarion?', {
    intent:'web_fact', entity:'Astarion', game:"Baldur's Gate 3",
  });
  assert.match(plan.instruction, /głównej tożsamości lub definiującego statusu postaci/);
  assert.match(plan.instruction, /nie mogą zastąpić definiującej tożsamości/);
  assert.match(plan.instruction, /wampirzy pomiot/);
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
  assert.equal(purpose.motive_explanation, true);
  assert.equal(purpose.causal_explanation, false);
  assert.equal(purpose.steps, false);

  const explicitCause = extractAnswerSignals('Wheatley przejął kontrolę z powodu awarii systemu.');
  assert.equal(explicitCause.why, true);
  assert.equal(explicitCause.motive_explanation, false);
  assert.equal(explicitCause.causal_explanation, true);
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

test('gameplay answer guidance names the scoped encounter instead of overgeneralizing', () => {
  const plan = buildAnswerPlan('Jak pokonać smoka?', {
    intent: 'web_fact', is_gameplay: true, game: 'Skyrim',
  });
  assert.match(plan.instruction, /konkretnego bossa/);
  assert.match(plan.instruction, /Skyrim/);
});

test('v26 judge rejects generic relationship answer', () => {
  const plan = buildAnswerPlan('Jaka jest relacja Geralta i Yennefer?', {
    intent:'web_fact', is_lore:true, entity:'Geralt', game:'The Witcher 3',
  });
  const result = judgeAnswer('Ich relacja jest złożona.', plan);
  assert.equal(result.status, 'repair');
  assert.ok(result.missing.includes('relationship'));
});


test('response contract forbids redundant narration and preserves scope and uncertainty', () => {
  const contract = responseContract('lore');
  assert.match(contract, /Nie dodawaj metakomentarzy.*źródło potwierdza/s);
  assert.match(contract, /nie dopisuj końcowego podsumowania/s);
  assert.match(contract, /dokładny zakres źródła/);
  assert.match(contract, /Zachowuj niepewność źródła/);
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

test('retrieval planner targets Portal core-transfer lore only in its own game context', () => {
  const portalQueries = buildRetrievalQueries('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', {
    intent: 'web_fact', is_lore: true, entity: 'Wheatley', game: 'Portal 2', needs_web: true,
  });
  assert.ok(portalQueries.some(q => /cause reason motivation event core transfer/i.test(q)), JSON.stringify(portalQueries));

  const skyrimQueries = buildRetrievalQueries('Dlaczego Dragonborn został wciągnięty w konflikt ze smokami?', {
    intent: 'web_fact', is_lore: true, entity: 'Dragonborn', game: 'Skyrim', needs_web: true,
  });
  assert.ok(skyrimQueries.some(q => /cause reason motivation story conflict lore/i.test(q)), JSON.stringify(skyrimQueries));
  assert.ok(!skyrimQueries.some(q => /core transfer/i.test(q)), JSON.stringify(skyrimQueries));
});

test('retrieval selection prioritizes intent-specific evidence over generic profile queries', () => {
  const causalQuery = 'Dlaczego Wheatley przejął kontrolę nad GLaDOS? powód przyczyna motywacja why reason cause motivation';
  const targetedQuery = 'Wheatley Portal 2 cause reason motivation event core transfer lore';
  const genericLoreQuery = 'Portal 2 lore plot canon story';
  const atomicQuery = 'W grze Portal 2: Dlaczego Wheatley przejął kontrolę nad GLaDOS?';

  const selected = selectRetrievalQueries({
    atomicQueries: [atomicQuery],
    causalQuery,
    specializedQueries: [targetedQuery, genericLoreQuery],
    fallbackQueries: [],
    maxQueries: 3,
  });

  assert.deepEqual(selected, [causalQuery, targetedQuery, atomicQuery]);
  assert.ok(!selected.includes(genericLoreQuery));
});



test('variable encounter duration satisfies a quantity requirement without inventing a number', () => {
  const plan = buildAnswerPlan('Ile trwa walka z Malenią?', {
    intent: 'web_fact', is_lore: true, entity: 'Malenia', game: 'Elden Ring',
  });
  assert.equal(plan.quantityMayBeVariable, true);
  const answer = 'Walka z Malenią w Elden Ring nie ma stałego czasu; zależy od umiejętności gracza, buildu i strategii.';
  const completeness = assessAnswerCompleteness(answer, plan);
  assert.equal(completeness.ok, true, JSON.stringify(completeness));
  assert.equal(judgeAnswer(answer, plan).status, 'accepted');
});

test('variable-duration exception is not enabled for ordinary quantity questions', () => {
  const plan = buildAnswerPlan('Ile kosztuje Elden Ring?', { intent: 'web_fact', entity: 'Elden Ring', game: 'Elden Ring' });
  assert.equal(plan.quantityMayBeVariable, false);
});


test('answer signals recognize companion/romance relationships, broad outcomes, and English actions', () => {
  assert.equal(extractAnswerSignals('Geralt i Yennefer są towarzyszami, łączy ich romans.').relationship, true);
  assert.equal(extractAnswerSignals('Vesemir zostaje zabity przez Imleritha podczas bitwy.').outcome, true);
  assert.equal(extractAnswerSignals('Equip the weapon and use the sign.').steps, true);
});

test('a year after a Polish preposition is not mistaken for a location', () => {
  assert.equal(extractAnswerSignals('W 2024 roku rozpoczęto nowy etap projektu.').where, false);
});

test('inflected Polish relationship questions create the relationship requirement', () => {
  const plan = buildAnswerPlan('Jaką relację łączy Geralta i Yennefer?', { intent: 'web_fact', is_lore: true });
  assert.ok(plan.requirements.some(item => item.id === 'relationship'));
});


test('relationship signals do not match inside unrelated words', () => {
  const friendly = extractAnswerSignals('The friendly NPC offers a helpful service.');
  assert.equal(friendly.relationship, false);
  const friend = extractAnswerSignals('Geralt and Dandelion are friends.');
  assert.equal(friend.relationship, true);
  const polish = extractAnswerSignals('Bohaterowie nawiązują przyjaźń i sojusz.');
  assert.equal(polish.relationship, true);
});


test('relationship detection does not treat friendly as a relationship term', () => {
  assert.equal(extractAnswerSignals('The character is friendly to strangers.').relationship, false);
  assert.equal(extractAnswerSignals('Geralt is a friend of Yennefer.').relationship, true);
});
