'use strict';
// Testy negatywne dla punktu 2 recenzji: gałąź „claim_en kopiuje cytat” w
// spojnoscTlumaczeniaClaimu. Ta gałąź jest tautologiczna dla kontroli dowodu
// (claim_en == cytat), więc musi mieć własne strażniki.
const test = require('node:test');
const assert = require('node:assert');

const { spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

const CYTAT = 'Wheatley takes control of the Cathedral of Dragon Communion.';

test('podmiana encji jest wykrywana także wtedy, gdy claim_en kopiuje cytat', () => {
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Świątynią Smoczej Komunii.',
    CYTAT,
    { evidenceQuote: CYTAT },
  );
  // „Świątynia Smoczej Komunii” nie jest aliasem „Cathedral of Dragon Communion”
  // (w tabeli jest „Katedra Smoczej Komunii”), więc musi zostać odrzucona.
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /nazw[ay] własne|treści claimu/);
});

test('claim twierdzący pojęcie nieobecne w cytacie nie przechodzi', () => {
  // claim twierdzi „niszczy”, a cytat mówi tylko o przejęciu kontroli.
  // Jedno wspólne pojęcie (kontrola) nie może usprawiedliwiać braku „destrukcja”.
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę i zniszczy Katedrę Smoczej Komunii.',
    CYTAT,
    { evidenceQuote: CYTAT },
  );
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /kopiuje cytat/);
});

test('cytat zawierający pojęcie nieobecne w claimie nie przechodzi', () => {
  const cytat = 'Wheatley takes control of the Cathedral of Dragon Communion and destroys it.';
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Katedrą Smoczej Komunii.',
    cytat,
    { evidenceQuote: cytat },
  );
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /kopiuje cytat/);
});

test('poprawny claim z przetłumaczoną nazwą przechodzi, gdy claim_en kopiuje cytat', () => {
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Katedrą Smoczej Komunii.',
    CYTAT,
    { evidenceQuote: CYTAT },
  );
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});

test('ten sam claim z wiernym tłumaczeniem (nie kopią cytatu) też przechodzi', () => {
  const wynik = spojnoscTlumaczeniaClaimu(
    'Wheatley przejmuje kontrolę nad Katedrą Smoczej Komunii.',
    'Wheatley takes control of the Cathedral of Dragon Communion.',
    { evidenceQuote: CYTAT },
  );
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});

test('copied quote is rejected when it shares an entity but no verifiable action concept', () => {
  const quote = 'Geralt was born in the city.';
  const wynik = spojnoscTlumaczeniaClaimu(
    'Geralt odwiedza miasto.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /kopiuje cytat/);
});

test('copied Dragonborn quote accepts a faithful Polish identity claim', () => {
  const quote = 'A Dragonborn or Dovahkiin is a mortal man or woman born with the blood and soul of a dragon';
  const result = spojnoscTlumaczeniaClaimu(
    'Dragonborn, znany również jako Dovahkiin, jest śmiertelnym mężczyzną lub kobietą urodzonym z krwią i duszą smoka.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('copied Dark Brotherhood quote accepts a source-grounded faction and assassination claim', () => {
  const quote = 'The Dragonborn was said to have joined the Dark Brotherhood, taking contracts assassinating various denizens of Skyrim';
  const result = spojnoscTlumaczeniaClaimu(
    'Mówiono, że Dragonborn dołączył do Dark Brotherhood, przyjmując kontrakty na zabójstwo różnych mieszkańców Skyrim.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
