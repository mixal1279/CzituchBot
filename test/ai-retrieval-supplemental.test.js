'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSupplementalRetrievalQuery, isMultiPartQuestion } = require('../ai/retrieval');


test('a single question mark does not classify a question as multi-part', () => {
  assert.equal(isMultiPartQuestion('W grze Skyrim: Jak pokonać smoka?'), false);
  assert.equal(isMultiPartQuestion('W grze Portal 2: Dlaczego Wheatley przejął kontrolę nad GLaDOS?'), false);
  assert.equal(isMultiPartQuestion('W grze Baldur\'s Gate 3: Kim jest Astarion?'), false);
});

test('compound questions remain multi-part without relying on punctuation', () => {
  assert.equal(isMultiPartQuestion('Gdzie znaleźć miecz i jak go ulepszyć?'), true);
  assert.equal(isMultiPartQuestion('Kiedy Geralt przybywa do Novigradu i co tam robi?'), true);
});

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
