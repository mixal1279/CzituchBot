'use strict';
// Regresje dla bramki pokrycia zdań anaforycznych (punkt 1 recenzji).
//
// UWAGA na konstrukcję fixture'ów: zdanie anaforyczne musi DZIELIĆ słowo
// z claimem, inaczej odpada na samym progu tokenowym i gałąź anaforyczna
// w ogóle się nie wykonuje. Test z zerowym pokryciem leksykalnym wygląda
// na strażnika, a nie jest niczym.
const test = require('node:test');
const assert = require('node:assert');

const { sprawdzPokrycieClaimamiOdpowiedzi, liczbyDoPorownania } = require('../ai/claimValidation');

const ZRODLO = [{
  id: 'SOURCE 1',
  tytul: 'Novigrad',
  tresc: 'Geralt przybywa do Novigradu i zostaje na targu, gdzie kupuje miecz.',
  url: 'https://example.org/novigrad',
  blok: 'SOURCE 1: Geralt przybywa do Novigradu i zostaje na targu, gdzie kupuje miecz.',
}];

const CLAIM = {
  claim: 'Geralt przybywa do Novigradu.',
  source_ids: ['SOURCE 1'],
  evidence_quote: 'Geralt przybywa do Novigradu i zostaje na targu, gdzie kupuje miecz.',
};

// Claim dzielący z zdaniem anaforycznym słowo „lat” — dzięki temu gałąź
// anaforyczna jest osiągana (pokrycie leksykalne 0,20 > 0,15).
const CLAIM_DZIELACY = {
  claim: 'Geralt spędził w Novigradzie dwadzieścia lat.',
  source_ids: ['SOURCE 1'],
  evidence_quote: 'Geralt przybywa do Novigradu i zostaje na targu, gdzie kupuje miecz.',
};

test('fixture rzeczywiście osiąga gałąź anaforyczną', () => {
  // Bez tego warunku pozostałe testy mogłyby przechodzić wskutek progu
  // tokenowego, a nie wskutek działania gałęzi anaforycznej.
  const zdanie = 'Jego historia trwa trzysta lat.';
  const tokens = liczbyDoPorownania(zdanie);
  assert.ok(tokens.includes('trzysta'), 'liczba słowna musi być widoczna dla kontroli');
  const r = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. Jego historia trwa trzysta lat.',
    [CLAIM, CLAIM_DZIELACY],
    ZRODLO,
  );
  assert.equal(r.ok, false, 'fixture musi być odrzucony');
  assert.match(String(r.uncovered[0] || ''), /trzysta lat/);
});

test('zmyślona liczba słowna w zdaniu anaforycznym nie przechodzi pokrycia', () => {
  const r = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. Jego historia trwa trzysta lat.',
    [CLAIM, CLAIM_DZIELACY],
    ZRODLO,
  );
  assert.equal(r.ok, false);
  assert.match(String(r.uncovered[0] || ''), /trzysta lat/);
});

test('podmiana liczby słownej wobec potwierdzonej liczby nie przechodzi', () => {
  // Źródło potwierdza „trzysta lat”; odpowiedź twierdzi „czterysta lat”.
  const zrodlo = [{
    id: 'SOURCE 1', tytul: 'Kroniki', tresc: 'Historia trwa trzysta lat.',
    url: 'https://example.org/kroniki', blok: 'SOURCE 1: Historia trwa trzysta lat.',
  }];
  const r = sprawdzPokrycieClaimamiOdpowiedzi(
    'Historia trwa trzysta lat. Jego historia trwa czterysta lat.',
    [{
      claim: 'Historia trwa trzysta lat.',
      source_ids: ['SOURCE 1'],
      evidence_quote: 'Historia trwa trzysta lat.',
    }],
    zrodlo,
  );
  assert.equal(r.ok, false);
  assert.match(String(r.uncovered.find(t => /czterysta/.test(t)) || ''), /czterysta/);
});

test('zdanie anaforyczne z inną liczbą niż w claimie nie przechodzi pokrycia', () => {
  // „On spędził tam dwadzieścia lat” jest tym samym faktem co claim i przechodzi
  // słusznie; inna liczba już nie.
  const tenSamFakt = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. On spędził tam dwadzieścia lat.',
    [CLAIM, CLAIM_DZIELACY],
    ZRODLO,
  );
  assert.equal(tenSamFakt.ok, true, JSON.stringify(tenSamFakt.uncovered));

  const innaLiczba = sprawdzPokrycieClaimamiOdpowiedzi(
    'Geralt przybywa do Novigradu. On spędził tam pięćdziesiąt lat.',
    [CLAIM, CLAIM_DZIELACY],
    ZRODLO,
  );
  assert.equal(innaLiczba.ok, false);
  assert.match(String(innaLiczba.uncovered[0] || ''), /pięćdziesiąt/);
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
        evidence_quote: 'Geralt przybywa do Novigradu i zostaje na targu, gdzie kupuje miecz.',
      },
    ],
    ZRODLO,
  );
  assert.equal(r.ok, true, JSON.stringify(r.uncovered));
});
