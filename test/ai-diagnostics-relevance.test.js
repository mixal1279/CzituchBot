'use strict';
// Diagnostyka: statystyki filtra treści Tavily i sourceScores w retrievalTrace.
const test = require('node:test');
const assert = require('node:assert');
const tavily = require('../ai/tavily');
const { assessEvidence } = require('../ai/core');

test('filtr treści raportuje dopasowanie słów dla pytania w innym języku niż strona', () => {
  const page = Array.from({ length: 12 }, (_, i) => `Skyrim guide paragraph ${i} about exploration and quests.`).join('\n')
    + '\nTo defeat a dragon, use Dragonrend to force it to land.';
  const pl = {};
  tavily.filtrujMaterialPoSlowachTavily(page, 'W grze Skyrim: Jak pokonać smoka?', pl);
  const en = {};
  tavily.filtrujMaterialPoSlowachTavily(page, 'Skyrim how to defeat a dragon', en);
  assert.ok(pl.keywords > 0 && en.keywords > 0);
  assert.ok(en.matchedKeywords > pl.matchedKeywords, JSON.stringify({ pl, en }));
});

test('assessEvidence zwraca sourceScores w retrievalTrace', () => {
  const result = assessEvidence([
    { url: 'https://en.uesp.net/wiki/Skyrim:Dragons', title: 'Skyrim:Dragons', content: 'Dragons are creatures in Skyrim. Use Dragonrend to defeat a dragon.' },
  ], 'W grze Skyrim: Jak pokonać smoka?', { entity: 'Skyrim', game: 'Skyrim', is_gameplay: true });
  const scores = result.retrievalTrace.sourceScores;
  assert.ok(Array.isArray(scores) && scores.length === 1, JSON.stringify(scores));
  assert.ok('relevance' in scores[0] && 'titleRelevance' in scores[0] && 'coreScore' in scores[0]);
});
