'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { wyodrebnijLiczbyIDaty, wyodrebnijJednostkoweWartosci, spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

const decadeFacts = text => wyodrebnijLiczbyIDaty(text).filter(fact => fact.startsWith('decade:'));
const plainYears = text => wyodrebnijLiczbyIDaty(text).filter(fact => !fact.startsWith('decade:'));

// Polska forma długa „lata 2000.” / „w latach 2010” to dekada, tak jak angielskie „2000s”.
test('Polish long-form decades are decade facts, not plain years', () => {
  assert.deepEqual(decadeFacts('Popularne w latach 2000.'), ['decade:2000']);
  assert.deepEqual(plainYears('Popularne w latach 2000.'), []);
  assert.deepEqual(decadeFacts('Gra była popularna w latach 2010 i później.'), ['decade:2010']);
  assert.deepEqual(decadeFacts('Gra z lat 1990.'), ['decade:1990']);
  assert.deepEqual(decadeFacts('Muzyka lat 2000-te.'), ['decade:2000']);
});

// Zakres, lista i rok niebedący początkiem dekady zostają zwykłymi liczbami.
test('ranges, lists and ordinary years after "lata" stay plain years', () => {
  for (const text of [
    'Wydano w latach 2010–2013.',
    'Wydano w latach 2010-2013.',
    'Wydano w latach 2010 do 2013.',
    'Wydano w latach 2000 i 2010.',
    'Wydano w latach 2000, 2005 oraz 2010.',
  ]) {
    assert.deepEqual(decadeFacts(text), [], text);
  }
  assert.deepEqual(plainYears('Wydano w latach 2010–2013.'), ['2010', '2013']);
  assert.deepEqual(plainYears('Wydano w latach 2012.'), ['2012']);
  assert.deepEqual(decadeFacts('Wydano w latach 2012.'), []);
  assert.deepEqual(plainYears('Wydano w 2010 roku.'), ['2010']);
});

// „lata 2000” nie jest „2000 lat”: alias „lata” dawał fałszywą jednostkę 2000:year.
test('a decade after "lata" is not a duration in years', () => {
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Popularne w latach 2000.'), []);
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Wydano w latach 2012.'), []);
  // Prawdziwa długość w latach nadal jest jednostką.
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Trwa 20 lat.'), ['20:year']);
});

test('a Polish long-form decade translates to the English decade', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Gra była popularna w latach 2000.',
    'The game was popular in the 2000s.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));

  const wrong = spojnoscTlumaczeniaClaimu(
    'Gra była popularna w latach 2000.',
    'The game was popular in the 2010s.',
  );
  assert.equal(wrong.ok, false, JSON.stringify(wrong));
});
