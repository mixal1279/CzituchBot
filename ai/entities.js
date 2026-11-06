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
  { name: 'Assassin’s Creed', type: 'franchise', aliases: ['assassin’s creed', "assassin's creed", 'assassins creed'] },
  { name: 'Baldur’s Gate 3', type: 'game', aliases: ['baldur’s gate 3', "baldur's gate 3", 'bg3'] },
  { name: 'Diablo IV', type: 'game', aliases: ['diablo iv', 'diablo 4'] },
  { name: 'The Last of Us', type: 'franchise', aliases: ['the last of us', 'tlou'] },
  { name: 'God of War', type: 'franchise', aliases: ['god of war'] },
  { name: 'Dying Light: The Beast', type: 'game', aliases: ['dying light the beast', 'dying light: the beast'] },
  { name: 'Dying Light', type: 'franchise', aliases: ['dying light'] },
  { name: 'Fallout 4', type: 'game', aliases: ['fallout 4'] },
  { name: 'Fallout', type: 'franchise', aliases: ['fallout'] },
  { name: 'Skyrim', type: 'game', aliases: ['skyrim', 'the elder scrolls v skyrim', 'elder scrolls v skyrim'] },
  { name: 'Starfield', type: 'game', aliases: ['starfield'] },
  { name: 'Fortnite', type: 'game', aliases: ['fortnite'] },
];


const COMPANY_ALIASES = [
  { name: 'Diablo Chairs', type: 'company', aliases: ['diablo chairs', 'diablochairs'] },
  { name: 'TSMC', type: 'company', aliases: ['tsmc', 'taiwan semiconductor manufacturing'] },
  { name: 'Samsung', type: 'company', aliases: ['samsung'] },
  { name: 'Sony', type: 'company', aliases: ['sony'] },
  { name: 'NVIDIA', type: 'company', aliases: ['nvidia'] },
  { name: 'AMD', type: 'company', aliases: ['amd', 'advanced micro devices'] },
  { name: 'Intel', type: 'company', aliases: ['intel'] },
  { name: 'Microsoft', type: 'company', aliases: ['microsoft'] },
  { name: 'OpenAI', type: 'company', aliases: ['openai'] },
  { name: 'Google', type: 'company', aliases: ['google'] },
  { name: 'Valve', type: 'company', aliases: ['valve'] },
  { name: 'CD Projekt', type: 'company', aliases: ['cd projekt', 'cdprojekt'] },
  { name: 'Logitech', type: 'company', aliases: ['logitech'] },
  { name: 'Razer', type: 'company', aliases: ['razer'] },
  { name: 'Endorfy', type: 'company', aliases: ['endorfy'] },
  { name: 'Corsair', type: 'company', aliases: ['corsair'] },
  { name: 'MSI', type: 'company', aliases: ['msi'] },
  { name: 'Gigabyte', type: 'company', aliases: ['gigabyte'] },
  { name: 'ASUS', type: 'company', aliases: ['asus'] },
  { name: 'Qualcomm', type: 'company', aliases: ['qualcomm'] },
  { name: 'Xiaomi', type: 'company', aliases: ['xiaomi'] },
  { name: 'Dell', type: 'company', aliases: ['dell'] },
  { name: 'Lenovo', type: 'company', aliases: ['lenovo'] },
];

// Krótkie lub wieloznaczne nazwy firm wymagają dodatkowego kontekstu biznesowego.
const AMBIGUOUS_COMPANY_ALIASES = new Set(['apple', 'meta', 'valve', 'dell', 'msi']);
const COMPANY_CONTEXT_RE = /(?<![\p{L}\p{N}_])(?:firm(?:a|y|ie|ę|ą|ami|ach)|mark(?:a|i|ę|ą|ami|ach)|producent(?:a|em|owi|ów|ami|ach)?|przedsiębiorstw(?:o|a|em|ie|ami|ach)|spółk(?:a|i|ę|ą|om|ami|ach)|korporacj(?:a|i|ę|ą|om|ami|ach)|przychod(?:y|u|em|zie)?|obrot(?:y|u|em|ach)?|zysk(?:i|u|iem)?|wycen(?:a|y|ę|ą|ie)|giełd(?:a|y|ę|ą|zie)|ceo|prezes(?:a|em|owi|ów)?|założon\p{L}*|powstał\p{L}*|produkuje|wypuszcza|portfolio|produkty|sprzęt|fotele|procesor\p{L}*|karty\s+graficzne)(?![\p{L}\p{N}_])/iu;


// Rozpoznaje jawny kontekst przedsiębiorstwa także wtedy, gdy nazwa nie jest
// jeszcze obecna w lokalnym słowniku aliasów.
function czyPytanieOFirmie(text) {
  return COMPANY_CONTEXT_RE.test(String(text || ''));
}

function resolveCompanyEntity(text) {
  const normalizedText = normalizujEncje(text);
  const match = findAlias(normalizedText, COMPANY_ALIASES);
  if (!match) return null;
  const ambiguous = AMBIGUOUS_COMPANY_ALIASES.has(normalizujEncje(match.alias));
  if (ambiguous && !COMPANY_CONTEXT_RE.test(text)) return null;
  return {
    type: 'company',
    name: match.entry.name,
    confidence: match.confidence,
    matchedAlias: match.alias,
    resolution: 'deterministic',
  };
}

function resolveEntity(text) {
  return resolveCompanyEntity(text) || resolveGameEntity(text);
}

const CHARACTER_ALIASES = [
  { name: 'Wheatley', game: 'Portal 2', aliases: ['wheatley'] },
  { name: 'GLaDOS', game: 'Portal', aliases: ['glados'] },
  { name: 'Chell', game: 'Portal', aliases: ['chell'] },
  { name: 'Arthur Morgan', game: 'Red Dead Redemption 2', aliases: ['arthur morgan', 'arthur'] },
  { name: 'Dutch van der Linde', game: 'Red Dead Redemption 2', aliases: ['dutch van der linde', 'dutch'] },
  { name: 'Johnny Silverhand', game: 'Cyberpunk 2077', aliases: ['johnny silverhand', 'johnnyego silverhanda', 'johnnemu silverhandowi', 'johnnym silverhandem', 'johnny'] },
  { name: 'Geralt z Rivii', game: 'The Witcher 3: Wild Hunt', aliases: ['geralt', 'geralt z rivii'] },
  { name: 'Ciri', game: 'The Witcher 3: Wild Hunt', aliases: ['ciri'] },
  { name: 'Kratos', game: 'God of War', aliases: ['kratos'] },
  { name: 'Ellie', game: 'The Last of Us', aliases: ['ellie'] },
  { name: 'Joel Miller', game: 'The Last of Us', aliases: ['joel miller', 'joel'] },
  { name: 'Astarion', game: 'Baldur’s Gate 3', aliases: ['astarion'] },
  { name: 'Gale', game: 'Baldur’s Gate 3', aliases: ['gale'] },
  { name: 'Shadowheart', game: 'Baldur’s Gate 3', aliases: ['shadowheart'] },
  { name: 'Karlach', game: 'Baldur’s Gate 3', aliases: ['karlach'] },
  { name: 'Vesemir', game: 'The Witcher 3: Wild Hunt', aliases: ['vesemir'] },
  { name: 'Yennefer', game: 'The Witcher 3: Wild Hunt', aliases: ['yennefer'] },
  { name: 'Triss Merigold', game: 'The Witcher 3: Wild Hunt', aliases: ['triss merigold', 'triss'] },
  { name: 'Krwawy Baron', game: 'The Witcher 3: Wild Hunt', aliases: ['krwawy baron', 'krwawego barona', 'krwawemu baronowi', 'krwawym baronem', 'bloody baron'] },
  { name: 'Malenia', game: 'Elden Ring', aliases: ['malenia'] },
  { name: 'Radahn', game: 'Elden Ring', aliases: ['radahn'] },
  { name: 'Steve', game: 'Minecraft', aliases: ['steve'] },
  { name: 'Alex', game: 'Minecraft', aliases: ['alex'] },
  { name: 'Dragonborn', game: 'Skyrim', aliases: ['dragonborn', 'dovahkiin'] },
  { name: 'Lord Farquaad', game: 'Shrek', aliases: ['lord farquaad', 'lord farquad', 'farquaad', 'farquad'] },
];

// Krótkie, powszechne imiona są rozstrzygane tylko wtedy, gdy pytanie zawiera
// również kontekst gry. Zapobiega to deterministycznemu przypisywaniu np.
// „Arthur” do RDR2 bez żadnego sygnału kontekstowego.
const CONTEXT_REQUIRED_CHARACTER_ALIASES = new Set([
  'gale',
  'steve',
  'alex',
  'triss',
  'arthur',
  'dutch',
  'johnny',
  'ellie',
  'joel',
]);

function normalizujEncje(text) {
  return String(text || '').toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
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
  if (aliasToken.length < 6 || !token.startsWith(aliasToken)) return false;
  const extra = token.length - aliasToken.length;
  if (extra <= 2) return true;
  // Celownik/narzędnik/miejscownik liczby mnogiej: „Wheatleyowi”, „Geraltowi”,
  // „Geraltami”. Wąska lista końcówek, żeby nie łapać „Minecraftowo”.
  return extra === 3 && /^(?:owi|iem|iom|ego|emu|ych|ymi|ach|ami)$/.test(token.slice(aliasToken.length));
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
      // Dokładny alias zawsze wygrywa z nieścisłym (odmienionym); przy tej samej
      // dokładności decyduje pewność. Wcześniej `exact !==` podmieniało też
      // dokładny alias na mniej dokładny, zależnie od kolejności w tabeli.
      const better = !best
        || (candidate.exact && !best.exact)
        || (candidate.exact === best.exact && candidate.confidence > best.confidence);
      if (better) best = candidate;
    }
  }
  return best;
}

function scoreExternalGameCandidate(query, candidateName) {
  const normalize = value => normalizujEncje(value);
  const q = normalize(query);
  const n = normalize(candidateName);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qt = q.split(' ').filter(Boolean);
  const nt = n.split(' ').filter(Boolean);
  const overlap = nt.length ? nt.filter(token => qt.includes(token)).length / nt.length : 0;
  if (n.includes(q) || q.includes(n)) return Math.max(0.82, overlap);
  return overlap;
}

// Aliasy będące zwykłymi słowami są uznawane za grę tylko z kontekstem gamingowym.
const AMBIGUOUS_GAME_ALIAS_CONTEXT = {
  mc: /(?:^| )(?:gra|gry|grze|gier|game|serwer|server|mod|mody|survival|redstone|creeper|nether|ender|biom|craft|steve|alex|minecraft)(?: |$)/,
  portal: /(?:^| )(?:gra|gry|grze|gier|game|valve|aperture|chell|glados|wheatley|gun|test chamber|portal 2|portal2)(?: |$)/,
};

function gameAliasesForText(normalizedText) {
  return GAME_ALIASES.map((entry) => ({
    ...entry,
    aliases: entry.aliases.filter((alias) => {
      const rule = AMBIGUOUS_GAME_ALIAS_CONTEXT[alias];
      return !rule || rule.test(normalizedText);
    }),
  })).filter((entry) => entry.aliases.length);
}

// Wspólny sygnał gry dla routingu. Korzysta z tej samej tabeli aliasów co resolver,
// więc dodanie gry w jednym miejscu automatycznie rozszerza klasyfikację pytań.
function czyWspomnianoGre(text) {
  const normalizedText = normalizujEncje(text);
  return gameAliasesForText(normalizedText).some(entry =>
    entry.aliases.some(alias => containsAlias(normalizedText, alias))
  );
}

function followedByForeignSurname(rawText, alias, entry) {
  const tokens = String(rawText || '').match(/[\p{L}][\p{L}’']*/gu) || [];
  // Znane są tylko tokeny tej samej postaci (np. „Arthur Morgan”), bo „Miller”
  // należy do innej postaci („Joel Miller”).
  const known = new Set();
  for (const a of [entry.name, ...entry.aliases]) for (const t of tokenyEncji(a)) known.add(t);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (normalizujEncje(tokens[i]) !== alias) continue;
    const next = tokens[i + 1];
    if (/^\p{Lu}/u.test(next) && !known.has(normalizujEncje(next))) return true;
  }
  return false;
}

function resolveGameEntity(text) {
  const normalizedText = normalizujEncje(text);
  const game = findAlias(normalizedText, gameAliasesForText(normalizedText));
  const character = findAlias(normalizedText, CHARACTER_ALIASES, {});

  if (character) {
    const shortAlias = tokenyEncji(character.alias).length === 1
      && CONTEXT_REQUIRED_CHARACTER_ALIASES.has(normalizujEncje(character.alias));

    // Krótkie aliasy pozostają obsługiwane dla kompatybilności z istniejącym
    // routingiem, ale bez kontekstu gry dostają niższe zaufanie.
    const gameMentioned = Boolean(game && (game.entry.name === character.entry.game
      || character.entry.game.startsWith(game.entry.name)))
      || containsAlias(normalizedText, character.entry.game);
    const ambiguityPenalty = shortAlias && !gameMentioned ? 0.08 : 0;
    // „Arthur Miller”, „Joel Spolsky”: krótkie imię z dopisanym innym nazwiskiem
    // to inna osoba, nie postać z gry.
    if (shortAlias && !gameMentioned && followedByForeignSurname(text, character.alias, character.entry)) return null;
    return {
      type: 'character',
      name: character.entry.name,
      confidence: Math.max(0.65, character.confidence - ambiguityPenalty),
      game: character.entry.game,
      // Typ rozpoznanej GRY (nie typ dopasowanego aliasu). Gdy encją raportowaną
      // jest gra, entity_type musi ją opisywać — inaczej routing traktuje tytuł
      // gry jak postać i traci profil domen oraz twardą encję docelową.
      game_type: game?.entry?.type || 'game',
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

// Rozpoznaje wyłącznie tytuł jawnie wskazany przez użytkownika jako grę.
// Pozwala ominąć klasyfikator LLM, ale nie próbuje zgadywać tytułu z luźnego tekstu.
function wyodrebnijJawnyTytulGry(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 500) return null;
  const pattern = /(?:^|[^\p{L}\p{N}_])[wW](?:[eE])?\s+(?:[tT][eE][jJ]\s+)?[gG][rR][zZ][eE]\s+(?!(?:[kK][iI][mM]|[kK][tT][oO]|[cC][oO]|[jJ][aA][kK]|[cC][zZ][yY]|[dD][lL][aA][cC][zZ][eE][gG][oO]|[cC][zZ][eE][mM][uU]|[gG][dD][zZ][iI][eE]|[kK][iI][eE][dD][yY]|[jJ][eE][sS][tT]|[bB][yY][łl]|[bB][yY][lL][aA]|[bB][yY][łl][oO])\b)(?:"([^"\n]{1,120})"|“([^”\n]{1,120})”|([\p{L}\p{N}][\p{L}\p{N}'’:&-]*(?:\s+(?:(?:[oO][fF]|[tT][hH][eE]|[aA][nN][dD]|&)\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’:&-]*){0,4}))/u;
  const match = value.match(pattern);
  const title = (match?.[1] || match?.[2] || match?.[3] || '').replace(/\s+/g, ' ').replace(/[,:;.!?]+$/u, '').trim();
  if (!title || title.length > 120 || title.split(' ').length > 5) return null;
  return title;
}

function externalGameCandidateMatchesQuery(query, candidateName) {
  const directScore = scoreExternalGameCandidate(query, candidateName);
  if (directScore >= 0.72) return { ok: true, score: directScore, via: 'query_title_match' };
  const resolved = resolveGameEntity(query);
  if (resolved?.game) {
    const entityScore = scoreExternalGameCandidate(resolved.game, candidateName);
    if (entityScore >= 0.72) return { ok: true, score: entityScore, via: 'deterministic_entity' };
  }
  return { ok: false, score: directScore, via: 'no_query_grounding' };
}

module.exports = {
  GAME_ALIASES,
  COMPANY_ALIASES,
  CHARACTER_ALIASES,
  normalizujEncje,
  containsAlias,
  containsExactAlias,
  czyWspomnianoGre,
  scoreExternalGameCandidate,
  wyodrebnijJawnyTytulGry,
  externalGameCandidateMatchesQuery,
  resolveGameEntity,
  resolveCompanyEntity,
  czyPytanieOFirmie,
  resolveEntity,
};
