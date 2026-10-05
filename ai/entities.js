'use strict';

const GAME_ALIASES = [
  { name: 'Minecraft', type: 'game', aliases: ['minecraft', 'mc'] },
  { name: 'Portal 2', type: 'game', aliases: ['portal 2', 'portal2'] },
  { name: 'Portal', type: 'franchise', aliases: ['portal'] },
  { name: 'Cyberpunk 2077', type: 'game', aliases: ['cyberpunk', 'cyberpunk 2077', 'cp2077'] },
  { name: 'The Witcher 3: Wild Hunt', type: 'game', aliases: ['wiedźmin 3', 'wiedzmin 3', 'witcher 3', 'the witcher 3'] },
  { name: 'The Witcher', type: 'franchise', aliases: ['wiedźmin', 'wiedzmin', 'witcher'] },
  { name: 'Red Dead Redemption 2', type: 'game', aliases: ['rdr2', 'red dead 2', 'red dead redemption 2'] },
  { name: 'Red Dead Redemption', type: 'franchise', aliases: ['red dead redemption', 'red dead'] },
  { name: 'Grand Theft Auto V', type: 'game', aliases: ['gta v', 'gta 5', 'grand theft auto v', 'grand theft auto 5'] },
  { name: 'Grand Theft Auto VI', type: 'game', aliases: ['gta vi', 'gta 6', 'grand theft auto vi', 'grand theft auto 6'] },
  { name: 'Elden Ring', type: 'game', aliases: ['elden ring'] },
  { name: 'Dark Souls', type: 'franchise', aliases: ['dark souls'] },
  { name: 'Baldur’s Gate 3', type: 'game', aliases: ['baldur’s gate 3', "baldur's gate 3", 'bg3'] },
  { name: 'The Last of Us', type: 'franchise', aliases: ['the last of us', 'tlou'] },
  { name: 'God of War', type: 'franchise', aliases: ['god of war'] },
  { name: 'Dying Light: The Beast', type: 'game', aliases: ['dying light the beast', 'dying light: the beast'] },
  { name: 'Dying Light', type: 'franchise', aliases: ['dying light'] },
  { name: 'Fallout 4', type: 'game', aliases: ['fallout 4'] },
  { name: 'Fallout', type: 'franchise', aliases: ['fallout'] },
  { name: 'Skyrim', type: 'game', aliases: ['skyrim'] },
  { name: 'Starfield', type: 'game', aliases: ['starfield'] },
  { name: 'Fortnite', type: 'game', aliases: ['fortnite'] },
];

const CHARACTER_ALIASES = [
  { name: 'Wheatley', game: 'Portal 2', aliases: ['wheatley'] },
  { name: 'GLaDOS', game: 'Portal', aliases: ['glados'] },
  { name: 'Chell', game: 'Portal', aliases: ['chell'] },
  { name: 'Arthur Morgan', game: 'Red Dead Redemption 2', aliases: ['arthur morgan', 'arthur'] },
  { name: 'Dutch van der Linde', game: 'Red Dead Redemption 2', aliases: ['dutch van der linde', 'dutch'] },
  { name: 'Johnny Silverhand', game: 'Cyberpunk 2077', aliases: ['johnny silverhand', 'johnny'] },
  { name: 'Geralt z Rivii', game: 'The Witcher 3: Wild Hunt', aliases: ['geralt', 'geralt z rivii'] },
  { name: 'Ciri', game: 'The Witcher 3: Wild Hunt', aliases: ['ciri'] },
  { name: 'Kratos', game: 'God of War', aliases: ['kratos'] },
  { name: 'Ellie', game: 'The Last of Us', aliases: ['ellie'] },
  { name: 'Joel Miller', game: 'The Last of Us', aliases: ['joel miller', 'joel'] },
];

function normalizujEncje(text) {
  return String(text || '').toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function containsAlias(text, alias) {
  const textTokens = normalizujEncje(text).split(' ').filter(Boolean);
  const aliasTokens = normalizujEncje(alias).split(' ').filter(Boolean);
  if (!aliasTokens.length || textTokens.length < aliasTokens.length) return false;
  for (let i = 0; i <= textTokens.length - aliasTokens.length; i++) {
    let match = true;
    for (let j = 0; j < aliasTokens.length; j++) {
      const a = aliasTokens[j];
      const t = textTokens[i + j];
      if (t === a) continue;
      if (a.length >= 5 && t.startsWith(a)) continue;
      match = false;
      break;
    }
    if (match) return true;
  }
  return false;
}

function findAlias(text, entries) {
  let best = null;
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (!containsAlias(text, alias)) continue;
      const confidence = Math.min(0.99, 0.72 + Math.min(normalizujEncje(alias).length, 30) / 100);
      if (!best || confidence > best.confidence) best = { entry, alias, confidence };
    }
  }
  return best;
}

function resolveGameEntity(text) {
  const character = findAlias(text, CHARACTER_ALIASES);
  const game = findAlias(text, GAME_ALIASES);
  if (character) {
    return { type: 'character', name: character.entry.name, confidence: character.confidence, game: character.entry.game, matchedAlias: character.alias, resolution: 'deterministic' };
  }
  if (game) {
    return { type: game.entry.type, name: game.entry.name, confidence: game.confidence, game: game.entry.type === 'game' ? game.entry.name : null, matchedAlias: game.alias, resolution: 'deterministic' };
  }
  return null;
}

module.exports = { GAME_ALIASES, CHARACTER_ALIASES, normalizujEncje, resolveGameEntity };
