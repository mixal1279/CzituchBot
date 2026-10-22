'use strict';
// Regresje dla rozpoznawania języka dowodu i dla liczb słownych.
const test = require('node:test');
const assert = require('node:assert');

const { wyglądaNaAngielski, liczbyDoPorownania } = require('../ai/claimValidation');

test('polskie zdania nie są uznawane za angielskie', () => {
  const polskie = [
    'Geralt przybywa do Novigradu.',
    'Geralt przybywa do Novigradu i zostaje na targu.',
    'Wszystkie szczegóły da się potwierdzić.',
    'Można go zobaczyć tylko w nocy.',
    'Geralt nigdy nie odwiedzał Novigradu.',
    'Historia trwa trzysta lat.',
  ];
  for (const text of polskie) {
    assert.equal(wyglądaNaAngielski(text), false, `polskie zdanie uznane za angielskie: ${text}`);
  }
});

test('angielskie zdania są rozpoznawane jako angielskie', () => {
  const angielskie = [
    'Geralt arrives in Novigrad.',
    'Malenia defeated Radahn.',
    'The player finds the Zeta Keep.',
    'He takes control of the facility.',
    'Wheatley is an AI personality.',
    'Chell was in Iowa once.',
    'The unique sequel.',
    'The tavern serves ale.',
    'Jak and Daxter is a game.',
    'Po defeats Tai Lung.',
  ];
  for (const text of angielskie) {
    assert.equal(wyglądaNaAngielski(text), true, `angielskie zdanie uznane za polskie: ${text}`);
  }
});

test('liczby słowne są widoczne dla porównań w jednym języku', () => {
  const liczby = liczbyDoPorownania('Jego historia trwa trzysta lat.');
  assert.ok(liczby.includes('trzysta'), JSON.stringify(liczby));
  // Zapis cyfrowy nadal działa.
  assert.ok(liczbyDoPorownania('trwa 300 lat').includes('300'));
  // Nic nie jest liczbą.
  assert.deepEqual(liczbyDoPorownania('Geralt przybywa do Novigradu.'), []);
});
