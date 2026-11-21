'use strict';
// Regresje z benchmarku (fe86bc8): zdublowana encja w zapytaniach planu oraz
// normalizacja angielskiego query uzupełniającego.
const test = require('node:test');
const assert = require('node:assert');
const { buildRetrievalQueries } = require('../ai/planner');
const { normalizeTranslatedSearchQuery } = require('../ai/retrieval');

const CASES = [
  ['W grze Skyrim: Jak pokonać smoka?', { entity: 'Skyrim', game: 'Skyrim', is_gameplay: true, needs_web: true }],
  ['W grze Elden Ring: Gdzie znaleźć Wielki Miecz?', { entity: 'Elden Ring', game: 'Elden Ring', is_gameplay: true, needs_web: true }],
  ['W grze Portal 2: Kiedy Chell budzi się w Aperture Science?', { entity: 'Portal 2', game: 'Portal 2', is_lore: true, needs_web: true }],
  ['W grze Wiedźmin 3: Dlaczego Geralt zgodził się pomóc Baronowi w tej grze?', { entity: 'Wiedźmin 3', game: 'Wiedźmin 3', is_lore: true, needs_web: true }],
];

for (const [question, routing] of CASES) {
  test('plan nie dubluje encji i gry: ' + question.slice(0, 40), () => {
    const queries = buildRetrievalQueries(question, routing);
    const name = routing.entity;
    for (const query of queries) {
      const occurrences = query.split(name).length - 1;
      // Pytanie oryginalne zawiera nazwę raz; zapytania intencyjne też najwyżej raz.
      assert.ok(occurrences <= 1, `zdublowana encja w query: ${query}`);
    }
    assert.ok(queries.length >= 2, JSON.stringify(queries));
  });
}

test('normalizacja angielskiego query: poprawne tłumaczenie z doklejoną grą', () => {
  assert.equal(normalizeTranslatedSearchQuery('"how to defeat a dragon"', 'Skyrim'), 'Skyrim how to defeat a dragon');
  assert.equal(normalizeTranslatedSearchQuery('Query: Elden Ring Greatsword location', 'Elden Ring'), 'Elden Ring Greatsword location');
});

test('normalizacja angielskiego query: odrzuca puste, NONE, nieprzetłumaczone i za długie', () => {
  assert.equal(normalizeTranslatedSearchQuery('', 'Skyrim'), null);
  assert.equal(normalizeTranslatedSearchQuery('NONE', 'Skyrim'), null);
  assert.equal(normalizeTranslatedSearchQuery('Jak pokonać smoka w Skyrim', 'Skyrim'), null);
  assert.equal(normalizeTranslatedSearchQuery('x'.repeat(250), 'Skyrim'), null);
});

test('normalizacja angielskiego query: bierze tylko pierwszą linię odpowiedzi modelu', () => {
  assert.equal(
    normalizeTranslatedSearchQuery('how to defeat a dragon\nExplanation: translated from Polish', 'Skyrim'),
    'Skyrim how to defeat a dragon',
  );
});
