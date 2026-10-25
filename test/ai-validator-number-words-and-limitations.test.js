'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { spojnoscTlumaczeniaClaimu, czyOgraniczenieDowodowe, wyodrebnijNazwyWlasne } = require('../ai/claimValidation');

// Polski claim z cyframi może być wiernie przetłumaczony z liczbą słowną („over twenty years”).
test('English number words are accepted as the translation of Polish digits', () => {
  const ok = spojnoscTlumaczeniaClaimu(
    'Postać żyje około 20 lat.',
    'The character lives over twenty years.',
  );
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('a different English number word is still rejected', () => {
  const wrong = spojnoscTlumaczeniaClaimu(
    'Postać żyje około 20 lat.',
    'The character lives over thirty years.',
  );
  assert.equal(wrong.ok, false, JSON.stringify(wrong));
  assert.match(wrong.reason, /liczby/);
});

// Zastrzeżenie o braku dodatkowych metod w źródłach to zakres źródła, nie fakt o świecie.
test('a source-scoped limitation about methods is recognised, a factual sentence is not', () => {
  assert.equal(czyOgraniczenieDowodowe('Źródła nie podają dodatkowych metod zdobycia elytr.'), true);
  assert.equal(czyOgraniczenieDowodowe('Elytry można zdobyć tylko w statku Endu.'), false);
});

// „Relacja” otwierająca zdanie to rzeczownik pospolity, nie nazwa własna; prawdziwe nazwy w zdaniu zostają.
test('a sentence-initial common noun is not a proper name but real names are kept', () => {
  const names = wyodrebnijNazwyWlasne('Relacja z Johnnym rozwija się powoli.');
  assert.equal(names.includes('relacja'), false, JSON.stringify(names));
  assert.equal(names.includes('johnnym'), true, JSON.stringify(names));
});
