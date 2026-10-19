'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bakery = require('../billy-bakery');

test('pule tytułów i kajzerek mają ustalone rozmiary', () => {
  assert.equal(bakery.PIEKARZE_ZWYKLI.length, 24);
  assert.equal(bakery.PIEKARZE_RZADKIE.length, 10);
  assert.equal(bakery.PIEKARZE_LEGENDARNE.length, 6);
  assert.equal(bakery.KAJZERKI_ZWYKLE.length, 70);
  assert.equal(bakery.KAJZERKI_SPECJALNE.length, 20);
  assert.equal(bakery.KAJZERKI_TAJNE.length, 10);
  assert.equal(bakery.WYZWANIA_GOTOWE.length, 50);
});

test('zakwas osiąga 0 i 100, a specjalny komentarz pojawia się wyłącznie przy 100', () => {
  const zero = bakery.rollZakwas(() => 0);
  assert.equal(zero.value, 0);
  assert.equal(zero.special, false);
  const hundred = bakery.rollZakwas(() => 0.999999);
  assert.equal(hundred.value, 100);
  assert.equal(hundred.special, true);
  assert.match(hundred.comment, /ALARM PIEKARNICZY/);
});

test('świeżość i przypalenie mają pięć kompletnych przedziałów', () => {
  assert.equal(bakery.rollFromBands(bakery.SWIEZOSC_KOMENTARZE, () => 0).value, 0);
  assert.equal(bakery.rollFromBands(bakery.SWIEZOSC_KOMENTARZE, () => 0.999999).value, 100);
  assert.equal(bakery.rollFromBands(bakery.PRZYPALENIE_KOMENTARZE, () => 0).value, 0);
  assert.equal(bakery.rollFromBands(bakery.PRZYPALENIE_KOMENTARZE, () => 0.999999).value, 100);
  assert.equal(bakery.SWIEZOSC_KOMENTARZE.length, 5);
  assert.equal(bakery.PRZYPALENIE_KOMENTARZE.length, 5);
});

test('piekarz losuje tylko raz na użytkownika w ramach danego streama', () => {
  const cache = {};
  const first = bakery.getPiekarzForStream('viewer1', 'stream-123', {
    cache, persist: false, rng: () => 0.1,
  });
  const second = bakery.getPiekarzForStream('viewer1', 'stream-123', {
    cache, persist: false, rng: () => 0.99999,
  });
  const nextStream = bakery.getPiekarzForStream('viewer1', 'stream-456', {
    cache, persist: false, rng: () => 0.99999,
  });
  assert.equal(first.alreadyAssigned, false);
  assert.equal(second.alreadyAssigned, true);
  assert.deepEqual(second.title, first.title);
  assert.equal(nextStream.alreadyAssigned, false);
});

test('kajzerka BillyBulki jest stała w ciągu dnia i może się zmienić następnego dnia', () => {
  const cache = {};
  const first = bakery.getBillyBulkaForDay('2026-10-18', {
    cache, persist: false, rng: () => 0,
  });
  const second = bakery.getBillyBulkaForDay('2026-10-18', {
    cache, persist: false, rng: () => 0.99999,
  });
  const nextDay = bakery.getBillyBulkaForDay('2026-10-19', {
    cache, persist: false, rng: () => 0.99999,
  });
  assert.equal(first.alreadyAssigned, false);
  assert.equal(second.alreadyAssigned, true);
  assert.deepEqual(second.variant, first.variant);
  assert.equal(nextDay.alreadyAssigned, false);
});

test('komenda bułka ma specjalną pulę tylko dla BillyBulki', () => {
  const own = bakery.handleCommand({ message: '!bułka', nick: 'BillyBulka', login: 'billybulka' }, { cache: {}, persist: false, rng: () => 0 });
  assert.match(own, /@BillyBulka otrzymuje/);
  const targeted = bakery.handleCommand({ message: '!bułka @BillyBulka', nick: 'viewer', login: 'viewer' }, { cache: {}, persist: false, rng: () => 0 });
  assert.match(targeted, /@BillyBulka otrzymuje/);
  assert.equal(bakery.handleCommand({ message: '!bułka', nick: 'viewer', login: 'viewer' }), null);
});

test('komendy obsługują cel opcjonalny i generują odpowiedź', () => {
  for (const command of ['!zakwas', '!wyzwanie', '!piekarz', '!swiezy', '!smak', '!okruszek', '!przypalony']) {
    const response = bakery.handleCommand({
      message: command, nick: 'viewer', login: 'viewer', streamId: 'test-stream',
    }, { cache: {}, persist: false, rng: () => 0.2 });
    assert.equal(typeof response, 'string', command);
    assert.ok(response.includes('@viewer'), command);
  }
  const targeted = bakery.handleCommand({
    message: '!swiezy @BillyBulka', nick: 'viewer', login: 'viewer', streamId: 'test-stream',
  }, { cache: {}, persist: false, rng: () => 0.2 });
  assert.ok(targeted.includes('@BillyBulka'));
});

test('parser dziennej bułki obsługuje alias, własny login i wskazany cel', () => {
  assert.deepEqual(bakery.parseDailyBulkaCommand('!bułka', 'Viewer', 'viewer_login'), {
    targetDisplay: 'Viewer',
    targetLogin: 'viewer_login',
    isExplicitTarget: false,
  });
  assert.deepEqual(bakery.parseDailyBulkaCommand('!bulka @MiXal', 'Viewer', 'viewer_login'), {
    targetDisplay: 'MiXal',
    targetLogin: 'mixal',
    isExplicitTarget: true,
  });
  assert.equal(bakery.parseDailyBulkaCommand('!bułka dodatkowy argument', 'Viewer', 'viewer_login'), null);
  assert.equal(bakery.parseDailyBulkaCommand('!zakwas', 'Viewer', 'viewer_login'), null);
});
