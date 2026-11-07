'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { klasyfikujKandydataIGDB, wariantZapytania } = require('../ai/game-relations');

test('an unqualified Portal query resolves to franchise scope when IGDB confirms the relation', () => {
  const result = klasyfikujKandydataIGDB({
    id: 1,
    name: 'Portal',
    game_type: { name: 'Main Game' },
    franchise: { name: 'Portal' },
    first_release_date: 1193356800,
  }, { requestedTitle: 'Portal', question: 'Opowiedz o lore gry Portal' });
  assert.equal(result.ok, true);
  assert.equal(result.entity.type, 'franchise');
  assert.equal(result.entity.name, 'Portal');
  assert.equal(result.entity.game, null);
  assert.equal(result.entity.candidateGame, 'Portal');
});

test('a franchise relation can be grounded by a later sequel without selecting it as the first game', () => {
  const result = klasyfikujKandydataIGDB({
    id: 2,
    name: 'Portal 2',
    game_type: { name: 'Main Game' },
    franchise: { name: 'Portal' },
  }, { requestedTitle: 'Portal', question: 'Opowiedz o serii Portal' });
  assert.equal(result.ok, true);
  assert.equal(result.entity.type, 'franchise');
  assert.equal(result.entity.name, 'Portal');
});

test('a versioned edition is excluded from an unqualified base-game lookup', () => {
  const result = klasyfikujKandydataIGDB({
    id: 3,
    name: 'The Witcher 3: Wild Hunt - Complete Edition',
    game_type: { name: 'Main Game' },
    version_parent: { name: 'The Witcher 3: Wild Hunt' },
  }, { requestedTitle: 'The Witcher 3: Wild Hunt', question: 'Lore Wiedźmina 3' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'non_base_game_candidate');
});

test('DLC candidates require an explicit DLC/add-on request and a matching IGDB type', () => {
  const candidate = {
    id: 4,
    name: 'Phantom Liberty',
    game_type: { name: 'DLC Addon' },
    parent_game: { name: 'Cyberpunk 2077' },
  };
  assert.equal(klasyfikujKandydataIGDB(candidate, {
    requestedTitle: 'Phantom Liberty',
    question: 'Lore Cyberpunk 2077',
  }).ok, false);
  const explicit = klasyfikujKandydataIGDB(candidate, {
    requestedTitle: 'Phantom Liberty',
    question: 'Opowiedz o DLC Phantom Liberty',
  });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.entity.parentGame, 'Cyberpunk 2077');
});

test('remake, reboot, remaster and spin-off are never silently conflated', () => {
  const remake = { name: 'Example Remake', game_type: { name: 'Remake' } };
  assert.equal(klasyfikujKandydataIGDB(remake, {
    requestedTitle: 'Example Remake', question: 'Lore Example Remake',
  }).ok, false);
  assert.equal(klasyfikujKandydataIGDB(remake, {
    requestedTitle: 'Example Remake', question: 'Lore remake Example Remake',
  }).ok, true);
  assert.equal(wariantZapytania('Lore reboot Example', 'Example'), 'reboot');
  assert.equal(klasyfikujKandydataIGDB(remake, {
    requestedTitle: 'Example Remake', question: 'Lore reboot Example Remake',
  }).ok, false);
});

test('IGDB relation metadata preserves release date and collection links', () => {
  const result = klasyfikujKandydataIGDB({
    id: 5,
    name: 'Hades',
    game_type: { name: 'Main Game' },
    franchise: { name: 'Hades' },
    collections: [{ name: 'Supergiant Collection' }],
    first_release_date: 1599696000,
  }, { requestedTitle: 'Hades', question: 'Lore Hades' });
  assert.equal(result.ok, true);
  assert.equal(result.entity.firstReleaseDate, 1599696000);
  assert.deepEqual(result.entity.collections, ['Supergiant Collection']);
});
