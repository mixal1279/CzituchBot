'use strict';
// Testy negatywne dla punktu 2 recenzji: gałąź „claim_en kopiuje cytat” w
// spojnoscTlumaczeniaClaimu. Ta gałąź jest tautologiczna dla kontroli dowodu
// (claim_en == cytat), więc musi mieć własne strażniki.
const test = require('node:test');
const assert = require('node:assert');

const { spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

const CYTAT = 'Wheatley takes control of the Smoldering Church.';

test('podmiana encji jest wykrywana także wtedy, gdy claim_en kopiuje cytat', () => {
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Świątynią Palącego się.',
    CYTAT,
    { evidenceQuote: CYTAT },
  );
  // „Świątynia Palącego się” nie jest aliasem „Smoldering Church”
  // (w tabeli jest „Kościoła Palącego się”), więc musi zostać odrzucona.
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /nazw[ay] własne|treści claimu/);
});

test('claim twierdzący pojęcie nieobecne w cytacie nie przechodzi', () => {
  // claim twierdzi „niszczy”, a cytat mówi tylko o przejęciu kontroli.
  // Jedno wspólne pojęcie (kontrola) nie może usprawiedliwiać braku „destrukcja”.
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę i zniszczy Kościoła Palącego się.',
    CYTAT,
    { evidenceQuote: CYTAT },
  );
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /kopiuje cytat/);
});

test('cytat zawierający pojęcie nieobecne w claimie nie przechodzi', () => {
  const cytat = 'Wheatley takes control of the Smoldering Church and destroys it.';
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Kościoła Palącego się.',
    cytat,
    { evidenceQuote: cytat },
  );
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /kopiuje cytat/);
});

test('poprawny claim z przetłumaczoną nazwą przechodzi, gdy claim_en kopiuje cytat', () => {
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Kościoła Palącego się.',
    CYTAT,
    { evidenceQuote: CYTAT },
  );
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});

test('ten sam claim z wiernym tłumaczeniem (nie kopią cytatu) też przechodzi', () => {
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Kościoła Palącego się.',
    'Wheatley takes control of the Smoldering Church.',
    { evidenceQuote: CYTAT },
  );
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});
