'use strict';

const { resolveGameEntity, normalizujEncje } = require('./entities');

const PATTERNS = Object.freeze({
  franchise: /\b(?:franczyz\p{L}*|serii|seria|uniwersum|franchise|series|universe|cał(?:a|ej)\s+seria)\b/iu,
  addon: /\b(?:dlc|dodatek|dodatku|expansion|expansion\s+pack|add.?on)\b/iu,
  remake: /\bremake\b/iu,
  reboot: /\breboot\b/iu,
  remaster: /\bremaster\b/iu,
  spinoff: /\bspin[ -]?off\b/iu,
  version: /\b(?:edycj\p{L}*|edition|wersj\p{L}*|version|ultimate|deluxe|gold|collector)\b/iu,
  collection: /\b(?:kolekcj\p{L}*|collection|zestaw\s+gier)\b/iu,
});

const NON_BASE_TYPES = new Set([
  'dlc', 'dlc addon', 'expansion', 'standalone expansion', 'bundle',
  'remake', 'remaster', 'port', 'episode', 'season', 'mod', 'fork',
  'expanded game', 'spin off', 'reboot', 'pack', 'update',
]);

function nazwaRelacji(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && typeof value.name === 'string') return value.name.trim() || null;
  return null;
}

function nazwyRelacji(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(nazwaRelacji).filter(Boolean).slice(0, 12);
}

function maRelacje(value) {
  return (Array.isArray(value) && value.length > 0)
    || (value !== null && value !== undefined && value !== 0);
}

function wariantZapytania(question, requestedTitle) {
  const text = String(question || '');
  const title = String(requestedTitle || '').trim();
  const lowerText = text.toLocaleLowerCase('pl-PL');
  const lowerTitle = title.toLocaleLowerCase('pl-PL');
  const titleIndex = lowerTitle ? lowerText.indexOf(lowerTitle) : -1;
  const intentText = titleIndex >= 0
    ? text.slice(0, titleIndex) + ' ' + text.slice(titleIndex + title.length)
    : text;
  if (PATTERNS.collection.test(intentText)) return 'collection';
  if (PATTERNS.franchise.test(intentText)) return 'franchise';
  if (PATTERNS.addon.test(intentText)) return 'addon';
  if (PATTERNS.remake.test(intentText)) return 'remake';
  if (PATTERNS.reboot.test(intentText)) return 'reboot';
  if (PATTERNS.remaster.test(intentText)) return 'remaster';
  if (PATTERNS.spinoff.test(intentText)) return 'spinoff';
  if (PATTERNS.version.test(intentText)) return 'version';
  // Marker wariantu może być częścią jawnie wskazanego tytułu (np. "Complete Edition").
  if (PATTERNS.version.test(title)) return 'version';
  if (PATTERNS.remake.test(title)) return 'remake';
  if (PATTERNS.reboot.test(title)) return 'reboot';
  if (PATTERNS.remaster.test(title)) return 'remaster';
  if (PATTERNS.spinoff.test(title)) return 'spinoff';
  if (PATTERNS.addon.test(title)) return 'addon';
  const deterministic = resolveGameEntity('gra ' + title) || resolveGameEntity(requestedTitle) || resolveGameEntity(question);
  return deterministic?.type === 'franchise' ? 'franchise' : 'game';
}

function zgodnaNazwaRelacji(names, requestedTitle) {
  const wanted = normalizujEncje(requestedTitle);
  if (!wanted) return null;
  // Nazwa gry z prefiksem serii nie jest dowodem, że to ta sama encja-franczyza.
  // Relację potwierdzamy wyłącznie po dokładnej nazwie z metadanych IGDB.
  return names.find(name => normalizujEncje(name) === wanted) || null;
}

function klasyfikujKandydataIGDB(candidate, { requestedTitle, question } = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, reason: 'invalid_candidate' };
  }
  const title = nazwaRelacji(candidate.name);
  if (!title) return { ok: false, reason: 'missing_title' };

  const gameType = normalizujEncje(nazwaRelacji(candidate.game_type) || 'unknown');
  const franchiseNames = [
    ...nazwyRelacji(candidate.franchise),
    ...nazwyRelacji(candidate.franchises),
  ];
  const collectionNames = nazwyRelacji(candidate.collections);
  const parentGame = nazwaRelacji(candidate.parent_game);
  const versionParent = nazwaRelacji(candidate.version_parent);
  const requested = wariantZapytania(question, requestedTitle);

  if (requested === 'franchise' || requested === 'collection') {
    const relations = requested === 'collection'
      ? collectionNames
      : franchiseNames.length ? franchiseNames : collectionNames;
    const groupName = zgodnaNazwaRelacji(relations, requestedTitle);
    if (!groupName) return { ok: false, reason: 'franchise_relation_not_verified' };
    return {
      ok: true,
      entity: {
        type: 'franchise',
        name: groupName,
        game: null,
        franchise: groupName,
        collection: collectionNames[0] || null,
        scope: requested,
        gameType: gameType === 'unknown' ? null : gameType,
        candidateGame: title,
        candidateGameId: Number.isSafeInteger(candidate.id) ? candidate.id : null,
        firstReleaseDate: Number.isFinite(candidate.first_release_date) ? candidate.first_release_date : null,
        relations: { franchise: franchiseNames, collections: collectionNames },
      },
    };
  }

  const hasAddonParent = maRelacje(candidate.parent_game);
  const hasVersionParent = maRelacje(candidate.version_parent);
  if (requested === 'addon') {
    if (!/(?:dlc|addon|expansion)/.test(gameType)) {
      return { ok: false, reason: 'requested_addon_type_not_verified' };
    }
  } else if (requested === 'version') {
    if (!hasVersionParent && !/(?:edition|version)/.test(gameType)) {
      return { ok: false, reason: 'requested_version_not_verified' };
    }
  } else if (requested === 'remake' || requested === 'reboot' || requested === 'remaster' || requested === 'spinoff') {
    if (!gameType.includes(requested === 'spinoff' ? 'spin off' : requested)) {
      return { ok: false, reason: 'requested_variant_type_not_verified' };
    }
  } else if (hasAddonParent || hasVersionParent || gameType !== 'main game') {
    return { ok: false, reason: gameType === 'unknown' ? 'game_type_not_verified' : 'non_base_game_candidate' };
  }

  return {
    ok: true,
    entity: {
      type: 'game',
      name: title,
      game: title,
      gameType: gameType === 'unknown' ? null : gameType,
      franchise: franchiseNames[0] || null,
      collections: collectionNames,
      parentGame,
      versionParent,
      candidateGameId: Number.isSafeInteger(candidate.id) ? candidate.id : null,
      firstReleaseDate: Number.isFinite(candidate.first_release_date) ? candidate.first_release_date : null,
      relations: {
        remakes: nazwyRelacji(candidate.remakes),
        remasters: nazwyRelacji(candidate.remasters),
        dlcs: nazwyRelacji(candidate.dlcs),
        expansions: nazwyRelacji(candidate.expansions),
        standaloneExpansions: nazwyRelacji(candidate.standalone_expansions),
      },
    },
  };
}

module.exports = { wariantZapytania, klasyfikujKandydataIGDB };
