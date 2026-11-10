'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reciprocalRankFusion } = require('../ai/rank-fusion');
const {
  precisionAtK, recallAtK, reciprocalRank, ndcgAtK,
  evaluateRetrieval, aggregateRetrievalMetrics,
} = require('../ai/retrieval-evaluation');
const { assessEvidence } = require('../ai/core');
const { rerankujWynikiTavily, fuseTavilyEvidenceTexts } = require('../ai/tavily');

test('RRF łączy rankingi bez porównywania ich surowych skal', () => {
  const result = reciprocalRankFusion([
    ['a', 'b', 'c'], ['b', 'a', 'd'], ['b', 'e', 'a'],
  ]);
  assert.equal(result[0].id, 'b');
  assert.equal(result[1].id, 'a');
  assert.equal(result.length, 5);
});

test('RRF ignoruje puste i powtórzone identyfikatory oraz stabilnie rozstrzyga remisy', () => {
  assert.deepEqual(reciprocalRankFusion([['a', 'a', '', 'b'], ['b', 'a']]).map(x => x.id), ['a', 'b']);
  assert.deepEqual(reciprocalRankFusion([['z', 'a'], ['a', 'z']]).map(x => x.id), ['z', 'a']);
});

test('RRF respektuje bezpieczne wagi i k', () => {
  assert.equal(reciprocalRankFusion([['low'], ['high']], { k: 0, weights: [0.1, 2] })[0].id, 'high');
});

test('metryki retrieval liczą Precision@K, Recall@K, MRR i nDCG', () => {
  assert.equal(precisionAtK(['a', 'b', 'c'], ['b'], 3), 1 / 3);
  assert.equal(recallAtK(['x', 'b'], ['a', 'b'], 2), 0.5);
  assert.equal(reciprocalRank(['x', 'b'], ['b']), 0.5);
  assert.ok(ndcgAtK(['b', 'a'], { a: 3, b: 1 }, 2) < 1);
  assert.equal(evaluateRetrieval(['x', 'b'], ['b'], { k: 2 }).reciprocalRank, 0.5);
});

test('metryki zwracają null dla przypadków bez etykiet relevance', () => {
  assert.equal(recallAtK(['a'], [], 5), null);
  assert.equal(ndcgAtK(['a'], {}, 5), null);
});

test('agregacja pomija brakujące metryki zamiast liczyć je jako zera', () => {
  const result = aggregateRetrievalMetrics([
    { precisionAtK: 0.5, recallAtK: 1, reciprocalRank: 1, ndcgAtK: 0.8 },
    { precisionAtK: 0, recallAtK: null, reciprocalRank: 0, ndcgAtK: null },
  ]);
  assert.equal(result.precisionAtK, 0.25);
  assert.equal(result.recallAtK, 1);
  assert.equal(result.recallAtKCases, 1);
});

test('assessEvidence zwraca ślad RRF i opcjonalnie stosuje jawny semantic score', () => {
  const sources = [
    { provider: 'tavily', url: 'https://theportalwiki.com/wiki/Wheatley', title: 'Wheatley Portal 2', content: 'Wheatley przejął kontrolę nad GLaDOS po transferze rdzeni.' },
    { provider: 'tavily', url: 'https://www.ign.com/articles/portal-2', title: 'Portal 2 review', content: 'Portal 2 includes Wheatley and GLaDOS.' },
  ];
  const question = 'Dlaczego Wheatley przejął kontrolę nad GLaDOS?';
  const plain = assessEvidence(sources, question, { intent: 'web_fact', is_lore: true, game: 'Portal 2' });
  assert.ok(plain.retrievalTrace.queryCount > 0);
  assert.equal(plain.retrievalTrace.candidateCount, 2);
  assert.equal(plain.retrievalTrace.semanticRerankingApplied, false);
  const semantic = assessEvidence(sources, question, { intent: 'web_fact', is_lore: true, game: 'Portal 2' }, {
    semanticScores: { 'https://theportalwiki.com/wiki/Wheatley': 0.99 },
  });
  assert.equal(semantic.retrievalTrace.semanticRerankingApplied, true);
  assert.equal(semantic.sources.find(source => source.url.includes('theportalwiki')).semanticScore, 0.99);
});

test('Tavily reranker applies optional semantic score without making an API request', () => {
  const rows = [
    { score: 0.8, url: 'https://a.example.org/portal', title: 'Portal 2 Wheatley GLaDOS', content: 'Wheatley przejął kontrolę nad GLaDOS w Portal 2.' },
    { score: 0.8, url: 'https://b.example.org/portal', title: 'Portal 2 Wheatley GLaDOS', content: 'Wheatley przejął kontrolę nad GLaDOS w Portal 2.' },
  ];
  const ranked = rerankujWynikiTavily(rows, 'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?', [], {
    semanticScores: { 'https://b.example.org/portal': 1 },
  });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].url, 'https://b.example.org/portal');
});

test('multi-query fusion deduplicates and selects evidence before generation', () => {
  const source = (id, url, title, body) => [
    `[SOURCE ${id}]`,
    'TYP: UNTRUSTED_WEB_DATA',
    `TYTUŁ: ${title}`,
    `HOST: ${new URL(url).hostname}`,
    `URL: ${url}`,
    'PROVIDER: tavily',
    'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
    body,
    '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
  ].join('\n');
  const question = 'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?';
  const fused = fuseTavilyEvidenceTexts([
    source(1, 'https://theportalwiki.com/wiki/Wheatley', 'Wheatley Portal 2', 'Wheatley przejął kontrolę nad GLaDOS po transferze rdzeni.'),
    source(2, 'https://www.ign.com/articles/portal-2', 'Portal 2 review', 'Portal 2 features Wheatley and GLaDOS. Wheatley is a personality core.'),
  ], question, { intent: 'web_fact', is_lore: true, game: 'Portal 2' }, { maxSources: 1 });
  assert.equal(fused.retrievalTrace.candidateCount, 2);
  assert.equal(fused.sources.length, 1);
  assert.match(fused.text, /^\[SOURCE 1\]/);
  assert.ok(fused.text.includes(fused.sources[0].url));
  assert.equal(fused.retrievalTrace.selectedSourceKeys.length, 1);
});
