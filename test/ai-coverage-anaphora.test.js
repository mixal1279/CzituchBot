'use strict';
// Regresje dla bramki pokrycia zdań anaforycznych (punkt 4 recenzji).
// Gałąź anaforyczna jest najluźniejszą lokalną bramką: podmiot jest
// dziedziczony z poprzedniego zdania, więc kotwicą jest encja, a próg
// pokrycia leksykalnego niski (0,15). Testy poniżej przypinają zachowanie,
// którego nie wolno pogorszyć: zdanie zaimiennicze z zmyśloną liczbą lub
// nową treścią musi zostać odrzucone.
const test = require('node:test');
const assert = require('node:assert');

const { sprawdzPokrycieClaimamiOdpowiedzi } = require('../ai/claimValidation');

const ZRODLO = [{
  id: 'SOURCE 1',
  tytul: 'Novigrad',
  tresc: 'Geralt przybywa do Novigradu.',
  url: 'https://example.org/novigrad',
  blok: 'SOURCE 1: Geralt przybywa do Novigradu.',
}];

const CLAIM = {
  claim: 'Geralt przybywa do Novigradu.',
  source_ids: ['SOURCE 1'],
  evidence_quote: 'Geralt przybywa do Novigradu.',
};

test('zmyślona liczba w zdaniu anaforycznym nie przechodzi pokrycia', () => {
  const r = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. Jego historia trwa trzysta lat.',
    [CLAIM],
    ZRODLO,
  );
  assert.equal(r.ok, false);
  assert.match(String(r.uncovered[0] || ''), /trzysta lat/);
});

test('nowa treść w zdaniu anaforycznym nie przechodzi pokrycia', () => {
  const r = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. On spędził tam dwadzieścia lat.',
    [CLAIM],
    ZRODLO,
  );
  assert.equal(r.ok, false);
});

test('demonstratyw „te” nie kotwiczy zdania do encji z poprzedniego zdania', () => {
  const r = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. Te ziemie należały do karów.',
    [CLAIM],
    ZRODLO,
  );
  assert.equal(r.ok, false);
});

test('zdanie anaforyczne potwierdzone claimem o tej samej encji przechodzi', () => {
  // To jest pozytywna strona tej gałęzi: podmiot nie jest powtórzony, więc
  // pokrycie leksykalne jest niskie, a rozwiązana encja je zastępuje.
  const r = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. Jego przybycie odnotowano w kronikach.',
    [
      CLAIM,
      {
        claim: 'Przybycie Geralta do Novigradu odnotowano w kronikach.',
        source_ids: ['SOURCE 1'],
        evidence_quote: 'Geralt przybywa do Novigradu.',
      },
    ],
    ZRODLO,
  );
  assert.equal(r.ok, true, JSON.stringify(r.uncovered));
});
