'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

test('epistemic limitation keeps equivalent Polish and English negation', () => {
  const polish = 'Brak wystarczających danych w źródłach, aby określić, dlaczego Wheatley przejął kontrolę nad GLaDOS w grze Portal 2.';
  const english = 'Insufficient data exists in the sources to determine why Wheatley took control of GLaDOS in Portal 2.';
  const result = spojnoscTlumaczeniaClaimu(polish, english);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('source-level absence can be translated as no information without weakening factual negation checks', () => {
  const polish = 'Dostępne źródła nie zawierają informacji wyjaśniających, dlaczego Wheatley przejął kontrolę nad GLaDOS.';
  const english = 'The available sources contain no information explaining why Wheatley took control of GLaDOS.';
  const result = spojnoscTlumaczeniaClaimu(polish, english);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('epistemic exception does not accept a real-world negation reversal', () => {
  const polish = 'Wheatley nie przejął kontroli nad GLaDOS.';
  const english = 'Wheatley took control of GLaDOS.';
  const result = spojnoscTlumaczeniaClaimu(polish, english);
  assert.equal(result.ok, false);
  assert.match(result.reason, /negacj/i);
});
