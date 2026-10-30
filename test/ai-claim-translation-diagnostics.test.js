'use strict';
// Regresje dla Paczki 4 (diagnostyka kontraktu claim ↔ dowód).
const test = require('node:test');
const assert = require('node:assert');

const { dopasowanieSemantyczne, czyOgraniczenieDowodowe, spojnoscTlumaczeniaClaimu, zgodnoscStrukturalna, pojeciaCrossLanguage, czyNazwaWlasnaWystepuje, wyodrebnijNazwyWlasne } = require('../ai/claimValidation');

test('brak tłumaczenia claimu jest wskazywany wprost, a nie jako brak nazw własnych', () => {
  const withoutTranslation = dopasowanieSemantyczne(
    'The player finds Zeta Keep in the north.',
    'Gracz znajdzie Twierdzę Omega na północy.',
  );
  assert.equal(withoutTranslation.ok, false);
  assert.match(withoutTranslation.reason, /claim_en/);
  assert.match(withoutTranslation.reason, /nazw własnych/, 'powód nadal wskazuje, o co chodzi');

  // Gdy tłumaczenie jest, bramka wraca do pełnego sprawdzenia nazw.
  const withTranslation = dopasowanieSemantyczne(
    'The player finds Zeta Keep in the north.',
    'Gracz znajdzie Twierdzę Omega na północy.',
    { claimEn: 'The player finds Omega Keep in the north.' },
  );
  assert.equal(withTranslation.ok, false);
  assert.match(withTranslation.reason, /nazw własnych/);
});

test('zastrzeżenie o braku danych jest rozpoznawane jako zdanie bez twierdzenia', () => {
  assert.equal(czyOgraniczenieDowodowe('Źródła nie podają dokładnej daty ani momentu, w którym Geralt przybywa do Novigradu.'), true);
  assert.equal(czyOgraniczenieDowodowe('Geralt przybywa do Novigradu.'), false);
  assert.equal(czyOgraniczenieDowodowe('W grze The Witcher 3: Wild Hunt: Kiedy Geralt przybywa do Novigradu?'), false);
});

test('polskie „ograniczyć inteligencję” odpowiada angielskiemu „inhibit mental abilities”', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley został zaprojektowany jako rdzeń, który miał ograniczać zdolności umysłowe GLaDOS.',
    'Wheatley was designed as a core intended to inhibit GLaDOS’ mental abilities.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('marker ograniczenia nie pozwala ukryć sprzecznego wzrostu', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley został zaprojektowany, aby ograniczać inteligencję GLaDOS.',
    'Wheatley was designed to increase GLaDOS’ intelligence.',
  );
  assert.equal(result.ok, false);
});

test('opisowe „Dokładny” na początku claimu nie jest nazwą własną', () => {
  const names = wyodrebnijNazwyWlasne('Dokładny moment jego przybycia do miasta następuje przed walką z Dzikim Gonem.');
  assert.equal(names.includes('dokładny'), false, JSON.stringify(names));
  assert.equal(names.includes('wild hunt'), true, JSON.stringify(names));
});

test('polski zwrot „dając mu władzę” odpowiada angielskiemu „giving him control”', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Transfer ten przeniósł rdzeń GLaDOS do ciała Wheatleya, dając mu władzę nad obiektem.',
    "This transfer moved GLaDOS' core into Wheatley's body, giving him control of the facility.",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('Wieczny Ogień i Eternal Fire są rozpoznawane jako ta sama nazwa własna', () => {
  assert.equal(czyNazwaWlasnaWystepuje('eternal fire', 'The Eternal Fire protects the city.'), true);
});

test('alias rozszerzony o parafrazę angielską', () => {
  // „Aperture Science” w źródle bywa zapisane jako „the entire facility of Aperture”.
  const result = dopasowanieSemantyczne(
    'Wheatley, corrupt with the power from the entire facility of Aperture, quickly turns on Chell.',
    'Wheatley przejął kontrolę nad Aperture Science.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});


test('Minecraft End and Krawędź are treated as the same named region', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Elytra można zdobyć wyłącznie w Endzie, w statku znajdującym się przy niektórych miastach Krawędzi.',
    'Elytra are found exclusively in End ships, which are located in the outer islands of the End.',
    { evidenceQuote: 'Elytra are endgame equipment found exclusively in End ships, which are located in the outer islands of the End.' },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('Polish recruitment outcome matches a verbatim English source quote', () => {
  const quote = 'Taking him up on this offer will see him officially join your party.';
  assert.ok(pojeciaCrossLanguage('Dzięki temu zostaje zrekrutowany jako towarzysz.').has('towarzysz'));
  assert.ok(pojeciaCrossLanguage(quote).has('towarzysz'));
  const result = spojnoscTlumaczeniaClaimu(
    'Dzięki temu zostaje zrekrutowany jako towarzysz.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('explicit offer-to-join outcome satisfies the causal evidence gate', () => {
  const quote = 'Taking him up on this offer will see him officially join your party.';
  const result = zgodnoscStrukturalna(quote, 'Dzięki temu zostaje zrekrutowany jako towarzysz.');
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('a source saying a shulker guards elytra does not prove it must be killed', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Elytrę strzeże shulker, którego trzeba pokonać, aby móc ją zabrać.',
    'A shulker guards the elytra and loot chests.',
    { evidenceQuote: 'A shulker guards the elytra and loot chests.' },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
});
