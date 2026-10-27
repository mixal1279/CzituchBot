'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { wyodrebnijLiczbyIDaty, sprawdzTwardeKonflikty } = require('../ai/claimValidation');

const decadeFacts = text => wyodrebnijLiczbyIDaty(text).filter(fact => fact.startsWith('decade:'));

// Dekada była składana z cyfry wieku i cyfry dekady jako łańcuch, więc lata 2000. dawały
// „decade:200”, a lata 1900. „decade:190”. Teraz rok jest liczony numerycznie.
test('decade facts are computed numerically for every century', () => {
  assert.deepEqual(decadeFacts('Popular in the 1980s.'), ['decade:1980']);
  assert.deepEqual(decadeFacts('Popular in the 1990s.'), ['decade:1990']);
  assert.deepEqual(decadeFacts('Popular in the 2000s.'), ['decade:2000']);
  assert.deepEqual(decadeFacts('Popular in the 2010s.'), ['decade:2010']);
  assert.deepEqual(decadeFacts('Popular in the 1900s.'), ['decade:1900']);
});

test('the short form \'00s and "lat 00." mean the 2000s', () => {
  assert.deepEqual(decadeFacts("Big in the early '00s."), ['decade:2000']);
  assert.deepEqual(decadeFacts('Popularne we wczesnych latach 00.'), ['decade:2000']);
  // Istniejące formy działają bez zmian.
  assert.deepEqual(decadeFacts('pod koniec lat 80.'), ['decade:1980']);
  assert.deepEqual(decadeFacts("in the '90s"), ['decade:1990']);
});

test('2000s in the evidence confirms \'00s in the claim', () => {
  const result = sprawdzTwardeKonflikty(
    'The band was popular in the 2000s.',
    "The band was big in the '00s.",
    { ignoreNegation: true },
  );
  assert.equal(result.ok, true, JSON.stringify(result));

  // Inna dekada nadal jest odrzucana.
  const wrong = sprawdzTwardeKonflikty(
    'The band was popular in the 2010s.',
    "The band was big in the '00s.",
    { ignoreNegation: true },
  );
  assert.equal(wrong.ok, false, JSON.stringify(wrong));
});
