'use strict';
// Regresje dla Paczki 4 (diagnostyka kontraktu claim ↔ dowód).
const test = require('node:test');
const assert = require('node:assert');

const { dopasowanieSemantyczne, czyOgraniczenieDowodowe, spojnoscTlumaczeniaClaimu, czyNazwaWlasnaWystepuje } = require('../ai/claimValidation');

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
