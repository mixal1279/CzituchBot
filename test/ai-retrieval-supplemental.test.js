'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSupplementalRetrievalQuery } = require('../ai/retrieval');

test('supplemental retrieval anchors the original question to its resolved game', () => {
  const query = buildSupplementalRetrievalQuery('Gdzie znaleźć Wielki Miecz?', { game: 'Elden Ring' });
  assert.match(query, /Elden Ring/i);
  assert.match(query, /Gdzie znaleźć Wielki Miecz/i);
});

test('supplemental retrieval does not accept unverified cross-game locations as input', () => {
  // The builder intentionally has no unsupported-claims argument: rejected claims
  // must not be able to inject hallucinated locations into the next search.
  const query = buildSupplementalRetrievalQuery('Gdzie znaleźć Wielki Miecz?', { game: 'Elden Ring' });
  assert.doesNotMatch(query, /Iron Keep|Deep Church|Sunlit Bell Tower|Dark Souls II/i);
});

test('supplemental retrieval does not duplicate a game already in the question', () => {
  const query = buildSupplementalRetrievalQuery('Gdzie znaleźć Wielki Miecz w Elden Ring?', { game: 'Elden Ring' });
  assert.equal((query.match(/Elden Ring/gi) || []).length, 1);
});

test('causal supplemental retrieval adds causal search terms while preserving the game anchor', () => {
  const query = buildSupplementalRetrievalQuery('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', { game: 'Portal 2' }, true);
  assert.match(query, /Portal 2/i);
  assert.match(query, /cause reason motivation/i);
});
