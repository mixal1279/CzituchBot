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
  const remake = { name: 'Example 2', game_type: { name: 'Remake' } };
  assert.equal(klasyfikujKandydataIGDB(remake, {
    requestedTitle: 'Example 2', question: 'Lore Example 2',
  }).ok, false);
  assert.equal(klasyfikujKandydataIGDB(remake, {
    requestedTitle: 'Example 2', question: 'Lore remake Example 2',
  }).ok, true);
  assert.equal(wariantZapytania('Lore reboot Example 2', 'Example 2'), 'reboot');
  assert.equal(klasyfikujKandydataIGDB(remake, {
    requestedTitle: 'Example 2', question: 'Lore reboot Example 2',
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


test('a character question about Portal retains the franchise scope', () => {
  assert.equal(
    wariantZapytania('Kim jest GLaDOS w grze Portal?', 'Portal'),
    'franchise',
  );
});


test('unknown or non-main IGDB game types are never assumed to be a base game', () => {
  for (const gameType of [null, { name: 'Pack' }, { name: 'Update' }, { name: 'Expanded Game' }]) {
    const result = klasyfikujKandydataIGDB({
      name: 'Example',
      game_type: gameType,
    }, { requestedTitle: 'Example', question: 'Lore Example' });
    assert.equal(result.ok, false);
  }
});

test('a variant marker inside the explicitly resolved title must match IGDB type', () => {
  const candidate = { name: 'Example Remake', game_type: { name: 'Remake' } };
  assert.equal(wariantZapytania('Lore Example Remake', 'Example Remake'), 'remake');
  assert.equal(klasyfikujKandydataIGDB(candidate, {
    requestedTitle: 'Example Remake',
    question: 'Lore Example Remake',
  }).ok, true);
  assert.equal(klasyfikujKandydataIGDB(candidate, {
    requestedTitle: 'Example',
    question: 'Lore Example',
  }).ok, false);
  assert.equal(wariantZapytania('Lore reboot Example Remake', 'Example Remake'), 'reboot');
  assert.equal(klasyfikujKandydataIGDB(candidate, {
    requestedTitle: 'Example Remake',
    question: 'Lore reboot Example Remake',
  }).ok, false);
});


test('a Complete Edition is accepted only when the requested title explicitly names it', () => {
  const candidate = {
    name: 'The Witcher 3: Wild Hunt - Complete Edition',
    game_type: { name: 'Main Game' },
    version_parent: { name: 'The Witcher 3: Wild Hunt' },
  };
  assert.equal(klasyfikujKandydataIGDB(candidate, {
    requestedTitle: 'The Witcher 3: Wild Hunt',
    question: 'Lore Wiedźmina 3',
  }).ok, false);
  assert.equal(klasyfikujKandydataIGDB(candidate, {
    requestedTitle: 'The Witcher 3: Wild Hunt Complete Edition',
    question: 'Lore Wiedźmina 3 Complete Edition',
  }).ok, true);
});


test('a similar franchise-name prefix cannot substitute for an exact IGDB franchise relation', () => {
  const result = klasyfikujKandydataIGDB({
    id: 6,
    name: 'Portal 2',
    game_type: { name: 'Main Game' },
    franchise: { name: 'Portal 2' },
  }, { requestedTitle: 'Portal', question: 'Opowiedz o serii Portal' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'franchise_relation_not_verified');
});


test('sequel and prequel questions are recognized but never inferred from IGDB chronology alone', () => {
  assert.equal(wariantZapytania('Czy Portal 2 jest sequelem Portal?', 'Portal 2'), 'sequel');
  assert.equal(wariantZapytania('Czy ta gra jest prequelem Portal?', 'Portal'), 'prequel');
  assert.equal(wariantZapytania('Czy to sequel czy prequel Portal?', 'Portal'), 'sequence');
  for (const question of [
    'Czy Portal 2 jest sequelem Portal?',
    'Czy ta gra jest prequelem Portal?',
    'Czy to sequel czy prequel Portal?',
  ]) {
    const result = klasyfikujKandydataIGDB({
      id: 7,
      name: 'Portal 2',
      game_type: { name: 'Main Game' },
      franchise: { name: 'Portal' },
      first_release_date: 1276646400,
    }, { requestedTitle: 'Portal 2', question });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'sequel_prequel_not_directly_exposed_by_igdb');
  }
});

test('IGDB version_title can ground an explicitly requested special edition', () => {
  const result = klasyfikujKandydataIGDB({
    id: 8,
    name: 'Example Complete Edition',
    game_type: { name: 'Main Game' },
    version_title: 'Complete Edition',
  }, {
    requestedTitle: 'Example Complete Edition',
    question: 'Lore Example Complete Edition',
  });
  assert.equal(result.ok, true);
  assert.equal(result.entity.versionTitle, 'Complete Edition');
});

test('extended IGDB relation arrays are preserved without relabeling them as sequels or spin-offs', () => {
  const result = klasyfikujKandydataIGDB({
    id: 9,
    name: 'Example',
    game_type: { name: 'Main Game' },
    expanded_games: [{ name: 'Example Expanded' }],
    forks: [{ name: 'Example Fork' }],
    ports: [{ name: 'Example Port' }],
    bundles: [{ name: 'Example Bundle' }],
    similar_games: [{ name: 'Example Similar' }],
  }, { requestedTitle: 'Example', question: 'Lore Example' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.entity.relations, {
    remakes: [],
    remasters: [],
    dlcs: [],
    expansions: [],
    standaloneExpansions: [],
    expandedGames: ['Example Expanded'],
    forks: ['Example Fork'],
    ports: ['Example Port'],
    bundles: ['Example Bundle'],
    similarGames: ['Example Similar'],
  });
});
