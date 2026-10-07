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
  { name: 'Lord Farquaad', game: 'Shrek', aliases: ['lord farquaad', 'lord farquad', 'farquaad', 'farquad'] },
];

// Krótkie, powszechne imiona są rozstrzygane tylko wtedy, gdy pytanie zawiera
// również kontekst gry. Zapobiega to deterministycznemu przypisywaniu np.
// „Arthur” do RDR2 bez żadnego sygnału kontekstowego.
const CONTEXT_REQUIRED_CHARACTER_ALIASES = new Set([
  'arthur',
  'dutch',
  'johnny',
  'ellie',
  'joel',
]);

function normalizujEncje(text) {
  return String(text || '').toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tokenyEncji(text) {
  return normalizujEncje(text).split(' ').filter(Boolean);
}

function tokenPasujeDoAliasu(token, aliasToken) {
  if (token === aliasToken) return true;
  // Dopuszczamy typowe końcówki fleksyjne (maks. 3 znaki), ale nie dowolny
  // prefiks. To zachowuje np. „Wiedźminem” bez dopasowywania „Minecraftowo”.
  return aliasToken.length >= 6
    && token.startsWith(aliasToken)
    && token.length - aliasToken.length <= 2;
}

function containsAlias(text, alias) {
  const textTokens = tokenyEncji(text);
  const aliasTokens = tokenyEncji(alias);
  if (!aliasTokens.length || textTokens.length < aliasTokens.length) return false;
  for (let i = 0; i <= textTokens.length - aliasTokens.length; i++) {
    let match = true;
    for (let j = 0; j < aliasTokens.length; j++) {
      if (!tokenPasujeDoAliasu(textTokens[i + j], aliasTokens[j])) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function aliasLength(alias) {
  return tokenyEncji(alias).join('').length;
}

function containsExactAlias(text, alias) {
  const textTokens = tokenyEncji(text);
  const aliasTokens = tokenyEncji(alias);
  if (!aliasTokens.length || textTokens.length < aliasTokens.length) return false;
  for (let i = 0; i <= textTokens.length - aliasTokens.length; i++) {
    if (aliasTokens.every((token, offset) => textTokens[i + offset] === token)) return true;
  }
  return false;
}

function findAlias(text, entries, options = {}) {
  let best = null;
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (!containsAlias(text, alias)) continue;

      const normalizedAlias = normalizujEncje(alias);
      const exact = containsExactAlias(text, normalizedAlias);
      const confidence = Math.min(
        0.99,
        0.72 + Math.min(aliasLength(alias), 30) / 100 + (exact ? 0.04 : 0),
      );
      const candidate = { entry, alias, confidence, exact };
      if (!best
        || candidate.exact !== best.exact
        || candidate.confidence > best.confidence) {
        best = candidate;
      }
    }
  }
  return best;
}

function resolveGameEntity(text) {
  const normalizedText = normalizujEncje(text);
  const game = findAlias(normalizedText, GAME_ALIASES);
  const character = findAlias(normalizedText, CHARACTER_ALIASES, {});

  if (character) {
    const shortAlias = tokenyEncji(character.alias).length === 1
      && CONTEXT_REQUIRED_CHARACTER_ALIASES.has(normalizujEncje(character.alias));

    // Krótkie aliasy pozostają obsługiwane dla kompatybilności z istniejącym
    // routingiem, ale bez kontekstu gry dostają niższe zaufanie.
    const ambiguityPenalty = shortAlias && !containsAlias(normalizedText, character.entry.game) ? 0.08 : 0;
    return {
      type: 'character',
      name: character.entry.name,
      confidence: Math.max(0.65, character.confidence - ambiguityPenalty),
      game: character.entry.game,
      matchedAlias: character.alias,
      resolution: ambiguityPenalty ? 'deterministic_ambiguous' : 'deterministic',
    };
  }

  if (game) {
    return {
      type: game.entry.type,
      name: game.entry.name,
      confidence: game.confidence,
      game: game.entry.type === 'game' ? game.entry.name : null,
      matchedAlias: game.alias,
      resolution: 'deterministic',
    };
  }

  return null;
}

module.exports = {
  GAME_ALIASES,
  CHARACTER_ALIASES,
  normalizujEncje,
  containsAlias,
  containsExactAlias,
  resolveGameEntity,
};
