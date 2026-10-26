'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { wyodrebnijJednostkoweWartosci, spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

// \b w JavaScript nie traktuje polskich liter jako liter, więc „3 są” dawało „3 s” (sekundy),
// a „5 mężczyzn” dawało „5 m” (metry): każdy polski claim z liczbą przed takim słowem
// dostawał fałszywą jednostkę i odpadał w parytecie PL↔EN (why-005, live benchmark).
test('a Polish word starting with s or m after a number is not a unit', () => {
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Postacie w grze Baldur’s Gate 3 są związane wspólnym problemem.'), []);
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Gracz ma 5 mężczyzn w drużynie.'), []);
});

test('real short units are still extracted', () => {
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Rzut trwa 5 s.'), ['5:second']);
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Wieża ma 12 m wysokości.'), ['12:m']);
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Zasięg 2,5 m.'), ['2.5:m']);
});

test('a Polish claim with a title numeral before a Polish verb translates without a unit mismatch', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Postacie w grze Baldur’s Gate 3 są związane wspólnym problemem.',
    "The characters in Baldur's Gate 3 are bound by a shared problem.",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
