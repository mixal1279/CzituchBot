'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  czyNazwaWlasnaWystepuje,
  spojnoscTlumaczeniaClaimu,
} = require('../ai/claimValidation');

test('Witcher 3 Feline Armor is matched to its Polish localized name', () => {
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Zbroja Szkoły Kota'), true);
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Zbroja wiedźmińskiego cechu kota'), true);
});

test('Witcher 3 Temple Isle is matched to inflected Polish forms', () => {
  assert.equal(czyNazwaWlasnaWystepuje('temple isle', 'na Wyspie Świątynnej'), true);
  assert.equal(czyNazwaWlasnaWystepuje('temple isle', 'północna strona Wyspy Świątynnej'), true);
});

test('Witcher 3 Eye of Nehaleni is matched to Polish inflection', () => {
  assert.equal(czyNazwaWlasnaWystepuje('eye of nehaleni', 'używając Oka Nehaleni'), true);
});

test('Polish ochron* and English protection have matching translation polarity', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Astarion chce zyskać przychylność i ochronę postaci gracza przed Cazadorem.',
    "Astarion wants to gain the player character's favor and protection from Cazador.",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
