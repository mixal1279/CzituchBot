'use strict';

/**
 * AI Core v25
 *
 * Deterministyczny kontrakt dla pipeline'u RAG:
 * request -> retrieval plan -> evidence normalization -> evidence scoring
 * -> coverage/diversity decision -> generation/validation policy.
 *
 * Ten moduł nie wywołuje modeli ani sieci. Dzięki temu jego decyzje są
 * testowalne i nie zależą od providerów.
 */

const { GAME_ALIASES, CHARACTER_ALIASES, containsAlias } = require('./entities');

const STOPWORDS = new Set([
  'czy','jak','jaki','jaka','jakie','co','czym','kto','kim','kiedy','gdzie',
  'ile','dlaczego','czemu','jest','są','to','ten','ta','te','do','na','w','we',
  'z','ze','o','od','po','dla','i','oraz','a','ale','się','sie','mi','mnie',
  'jego','jej','ich','tym','tę','tą','być','ma','mają','miał','była','było',
  'były','mam','może','mogę','mozesz','możesz','the','and','or','of','in','to',
  'a','an','is','are','was','were','what','who','how','why','where','when'
]);

const AUTHORITY_ALIASES = {
  official: 'official',
  oficjalne: 'official',
  specialized: 'specialized',
  wyspecjalizowane: 'specialized',
  reference: 'reference',
  guide: 'guide',
  'guide/referencyjne': 'guide',
  general: 'general',
  'zewnętrzne-niezweryfikowane': 'general',
  unknown: 'unknown',
  nieznane: 'unknown',
};

const AUTHORITY = {
  official: 1,
  specialized: 0.92,
  reference: 0.82,
  guide: 0.72,
  general: 0.48,
  unknown: 0.25,
};

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Numery części („Portal 2”, „Wiedźmin 3”) i cyfry rzymskie odróżniają gry z jednej serii,
// ale w ogólnej trafności zaniżałyby źródła, które liczby nie powtarzają. Dlatego
// uwzględniamy je tylko na żądanie (dopasowanie encji).
function tokens(value, options = {}) {
  const keepNumbers = options.keepNumbers === true;
  return [...new Set(normalize(value).split(' ')
    .filter(t => (t.length >= 3 || (keepNumbers && (/^\d{1,2}$/.test(t) || /^(?:ii|iii|iv|vi|vii|viii|ix)$/.test(t)))) && !STOPWORDS.has(t)))];
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_) { return ''; }
}

function tokenOverlap(query, text, options = {}) {
  const q = tokens(query, options);
  const t = new Set(tokens(text, options));
  if (!q.length || !t.size) return 0;
  return q.filter(x => t.has(x)).length / q.length;
}

function classifyAuthority(source = {}) {
  const host = hostOf(source.url);
  const provider = normalize(source.provider);
  if (!host && !provider) return 'unknown';

  const official = [
    'minecraft.net','rockstargames.com','thewitcher.com','cdprojektred.com',
    'playstation.com','xbox.com','nintendo.com','naughtydog.com','larian.com',
    'baldursgate3.game','bandainamcoent.com','epicgames.com','ea.com',
    'ubisoft.com','bethesda.net','starwars.com','openai.com','discord.com',
    'valvesoftware.com','steampowered.com'
  ];
  const specialized = [
    'minecraft.wiki','gamelore.fandom.com','theportalwiki.com','bg3.wiki','combineoverwiki.net',
    'skyrim.fandom.com','cyberpunk.fandom.com','witcher.fandom.com','witcher-games.fandom.com','eldenring.fandom.com',
    'steamdb.info','howlongtobeat.com','pcgamingwiki.com'
  ];
  const reference = ['wikipedia.org','imdb.com','mobygames.com','isthereanydeal.com'];
  const guide = ['ign.com','gamespot.com','pcgamer.com','gamerant.com','polygon.com','gry-online.pl','eurogamer.net','eurogamer.pl','fandom.com'];

  const inList = list => list.some(d => host === d || host.endsWith('.' + d));
  if (inList(official)) return 'official';
  if (inList(specialized)) return 'specialized';
  if (inList(reference)) return 'reference';
  if (inList(guide)) return 'guide';
  if (/gamelore|gamefaqs|wiki|database|guide|walkthrough/.test(provider)) return 'specialized';
  return 'general';
}

function canonicalUrl(url) {
  try {
    const u = new URL(String(url));
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\/$/, '');
  } catch (_) { return String(url || '').trim().toLowerCase(); }
}

function sourceKey(source = {}) {
  const canonical = canonicalUrl(source.url);
  return canonical || normalize(source.title);
}

function cleanWikiMarkup(value) {
  let text = String(value || '');
  // Usuwamy elementy nawigacyjne MediaWiki i surowe znaczniki infoboxów,
  // które nie są treścią dowodową, a potrafią zanieczyścić ranking/negację.
  text = text
    .replace(/\{\s*"title"\s*:[\s\S]{0,4000}?\}\s*(?:\]\s*)?\}/giu, ' ')
    .replace(/\[(?:Jump to navigation|Jump to search|Przejdź do nawigacji|Przejdź do wyszukiwania)\]\([^)]*\)/giu, ' ')
    .replace(/\b(?:Jump to navigation|Jump to search|Przejdź do nawigacji|Przejdź do wyszukiwania)\b/giu, ' ')
    .replace(/\{\s*"(?:title|rows|field|label)"\s*:/giu, ' ')
    .replace(/\b(?:mw-head|searchInput|mw-content-text|toc)\b/giu, ' ')
    .replace(/<\/?(?:div|span|table|tbody|thead|tr|td|th|ul|ol|li|nav|sup|ref|figure|figcaption|p|h[1-6])\b[^>]*>/giu, ' ')
    .replace(/\[\[(?:Category|Kategoria):[^\]]+\]\]/giu, ' ')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/gu, '$1')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .replace(/\{\{[^{}]{0,500}\}\}/gu, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 12000);
}

function normalizeSource(source = {}, index = 0) {
  // Gemini grounding snippets are model-output spans tied to a URL, not page text.
  // webRetrieval deliberately marks them with content: ''; preserve that sentinel
  // instead of promoting the snippet into evidence during core normalization.
  const metadataOnlyGemini = /^gemini/i.test(String(source.provider || '')) && source.content === '';
  const content = cleanWikiMarkup(metadataOnlyGemini ? '' : (source.content || source.raw_content || source.snippet || ''));
  const title = String(source.title || '').slice(0, 300).replace(/\s+/g, ' ').trim();
  return {
    ...source,
    sourceId: source.sourceId || `SOURCE ${index + 1}`,
    url: String(source.url || '').slice(0, 2048).trim(),
    title,
    content,
    host: hostOf(source.url),
    authority: (() => {
      const rawAuthority = String(source.authority || '').trim().toLocaleLowerCase('pl-PL');
      const canonicalAuthority = AUTHORITY_ALIASES[rawAuthority] || rawAuthority;
      return Object.prototype.hasOwnProperty.call(AUTHORITY, canonicalAuthority)
        ? canonicalAuthority
        : classifyAuthority(source);
    })(),
    key: sourceKey(source),
  };
}

function scoreSource(source, query, options = {}) {
  const s = normalizeSource(source, Number(options.index) || 0);
  const q = String(query || '');
  const haystack = [s.title, s.content].join(' ');
  const relevance = Math.min(1, tokenOverlap(q, haystack) * 1.15);
  const titleRelevance = Math.min(1, tokenOverlap(q, s.title) * 1.4);
  const authority = AUTHORITY[s.authority] ?? AUTHORITY.unknown;

  let entityBonus = 0;
  const entityCandidates = [
    ...(Array.isArray(options.entities) ? options.entities : []),
    options.entity,
  ].map(value => String(value || '').trim()).filter(Boolean);
  const h = normalize(haystack);
  for (const entity of new Set(entityCandidates)) {
    const e = normalize(entity);
    if (e && h.includes(e)) {
      entityBonus = Math.max(entityBonus, 0.18);
      continue;
    }
    const overlap = tokenOverlap(entity, haystack, { keepNumbers: true });
    if (overlap >= 0.6) entityBonus = Math.max(entityBonus, 0.10);
  }

  let freshnessBonus = 0;
  if (options.freshness === 'live' || options.freshness === 'recent') {
    const date = source.publishedAt || source.published_date || source.date;
    if (date) {
      const publishedAt = new Date(date).getTime();
      const ageDays = (Date.now() - publishedAt) / 86400000;
      // Data z przyszłości nie może zdobywać bonusu świeżości.
      if (Number.isFinite(ageDays) && ageDays >= 0) {
        freshnessBonus = ageDays <= 7 ? 0.12 : ageDays <= 30 ? 0.06 : ageDays <= 90 ? 0 : -0.08;
      }
    }
  }

  const contentBonus = Math.min(0.08, s.content.length / 5000 * 0.08);
  const score = Math.max(0, Math.min(1,
    relevance * 0.38 +
    titleRelevance * 0.17 +
    authority * 0.32 +
    entityBonus +
    freshnessBonus +
    contentBonus
  ));

  return { ...s, coreScore: Number(score.toFixed(4)), relevance, titleRelevance, authorityScore: authority };
}

const ROMAN_SEQUEL_MARKERS = new Set(['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix']);
const SEQUEL_PREFIX_MARKERS = new Set(['part', 'episode', 'chapter']);

function czyZnacznikCzesci(token) {
  const value = String(token || '').trim().toLowerCase();
  if (ROMAN_SEQUEL_MARKERS.has(value)) return true;
  if (!value || value.length > 2) return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 99;
}

function czyZrodloDotyczyInnejCzesciGry(source, gameName, routing) {
  const entityType = routing.resolved_entity?.type || routing.entity_type;
  // Część gry ogranicza również retrieval postaci przypisanej do konkretnej odsłony.
  if (entityType !== 'game' && entityType !== 'character') return false;
  const requested = normalize(gameName);
  if (!requested) return false;
  const requestedLastToken = requested.split(' ').pop();
  if (czyZnacznikCzesci(requestedLastToken)) return false;

  const title = normalize(source.title);
  if (!title.startsWith(requested + ' ')) return false;
  const suffix = title.slice(requested.length).trim().split(' ').filter(Boolean);
  if (!suffix.length) return false;
  const marker = SEQUEL_PREFIX_MARKERS.has(suffix[0]) ? suffix[1] : suffix[0];
  return czyZnacznikCzesci(marker);
}

function sourceMatchesRequestContext(source = {}, routing = {}, question = '') {
  const resolved = routing.resolved_entity || {};
  const routeEntity = String(routing.entity || resolved.name || '').trim();
  const routeEntityIsGame = GAME_ALIASES.some(entry =>
    [entry.name, ...(entry.aliases || [])].some(alias => containsAlias(routeEntity, alias))
  );
  // Router potrafi ustawić entity_type=character, ale jako entity zwrócić
  // sam tytuł gry. W takim przypadku postacie wyciągamy bezpośrednio z pytania,
  // zamiast traktować nazwę gry jako nazwę bohatera.
  const hasCharacterScopeSignal = Boolean(
    routing.game
    || resolved.game
    || resolved.type === 'game'
    || resolved.type === 'character'
    || routing.entity_type === 'character'
  );
  const questionCharacters = hasCharacterScopeSignal
    ? CHARACTER_ALIASES.filter(entry =>
      [entry.name, ...(entry.aliases || [])].some(alias => containsAlias(question, alias))
    )
    : [];
  const explicitCharacter = resolved.type === 'character'
    ? resolved.name
    : (routing.entity_type === 'character' && !routeEntityIsGame ? routeEntity : '');
  const requestedCharacters = [...new Set([
    ...questionCharacters.map(entry => entry.name),
    ...(explicitCharacter ? [explicitCharacter] : []),
  ])];
  const characterScoped = requestedCharacters.length > 0;
  const gameNameForScope = resolved.game
    || (resolved.type === 'game' ? resolved.name : '')
    || routing.game
    || questionCharacters[0]?.game;
  // Pytania web_fact o konkretnych postaciach też wymagają dopasowania encji.
  // Nie ograniczamy tego filtra do lore/gameplay: router często klasyfikuje
  // pytanie „co stało się z X?” jako zwykły fakt.
  const needsEntityScope = Boolean(routing.is_lore || routing.is_gameplay || characterScoped);
  if (!needsEntityScope) return true;
  const haystack = [source.title, source.content, source.url].filter(Boolean).join(' ');
  const aliasesFor = (entries, name) => {
    const wanted = normalize(name);
    if (!wanted) return [];
    const entry = entries.find(item =>
      normalize(item.name) === wanted || item.aliases.some(alias => normalize(alias) === wanted)
    );
    return entry ? [entry.name, ...entry.aliases] : [String(name).trim()];
  };

  // A source about the right game is not sufficient for a request about a
  // specific character. For relationship questions, every named character
  // must be present in the same source.
  const franchiseScoped = resolved.type === 'franchise' || routing.entity_type === 'franchise';
  const franchiseName = resolved.name || (franchiseScoped ? routing.entity : '');
  if (franchiseScoped && franchiseName) {
    const franchiseAliases = aliasesFor(GAME_ALIASES, franchiseName);
    return franchiseAliases.some(alias => containsAlias(haystack, alias));
  }

  const gameName = gameNameForScope;
  if (gameName && czyZrodloDotyczyInnejCzesciGry(source, gameName, routing)) return false;
  if (characterScoped) {
    const matchesAllCharacters = requestedCharacters.every(characterName => {
      const characterAliases = aliasesFor(CHARACTER_ALIASES, characterName);
      return characterAliases.some(alias => containsAlias(haystack, alias));
    });
    if (!matchesAllCharacters) return false;

    // Sama nazwa postaci nie identyfikuje uniwersum (np. Alex, Chris, Jack).
    // Gdy znany jest kontekst gry, źródło musi potwierdzać jednocześnie postać
    // i grę; inaczej retrieval może połączyć materiały z różnych tytułów.
    if (gameName) {
      const gameAliases = aliasesFor(GAME_ALIASES, gameName);
      return gameAliases.some(alias => containsAlias(haystack, alias));
    }
    return true;
  }

  if (gameName) {
    const gameAliases = aliasesFor(GAME_ALIASES, gameName);
    return gameAliases.some(alias => containsAlias(haystack, alias));
  }
  return true;
}

// Tavily nie udostępnia parametru języka w Search API. Stosujemy więc
// ostrożny filtr po pobraniu: odrzucamy wyłącznie źródła z mocnym sygnałem
// języka trzeciego (np. portugalski), nie angielskie źródła używane normalnie
// do odpowiedzi na polskie pytania.
function wykryjJezykTekstu(value) {
  const original = String(value || '').slice(0, 12000);
  const text = normalize(original);
  if (!text) return { language: 'unknown', confidence: 0 };

  // Polskie pytania krótkie („Czym różni się X od Y?”) często nie osiągają
  // progu słownikowego po normalizacji. Rozpoznajemy je po polskich znakach
  // oraz co najmniej jednym charakterystycznym słowie funkcyjnym; sam polski
  // znak w nazwie własnej (np. „Łódź”) nie wystarcza.
  const polskieZnaki = /[ąćęłńóśźż]/iu.test(original);
  const polskieMarkery = new Set([
    'sie', 'czy', 'jak', 'kto', 'co', 'czym', 'gdzie', 'dlaczego', 'czemu',
    'jest', 'grze', 'zostal', 'zostala', 'oraz', 'ktory', 'ktora', 'ktore',
  ]);
  const markerCount = text.split(' ').filter(token => polskieMarkery.has(token)).length;
  if (polskieZnaki && markerCount >= 1) return { language: 'pl', confidence: 1 };

  const słowa = {
    pl: ['jest', 'oraz', 'ktory', 'ktora', 'ktore', 'gra', 'grze', 'postac', 'zostal', 'byla', 'nie', 'sie', 'kim', 'kto', 'co', 'czym', 'od', 'w', 'z', 'dla', 'czy', 'jak', 'gdzie', 'dlaczego', 'czemu'],
    en: ['the', 'and', 'is', 'are', 'was', 'were', 'with', 'from', 'this', 'that', 'character', 'game'],
    pt: ['uma', 'um', 'das', 'dos', 'nao', 'para', 'com', 'jogador', 'padrao', 'sao'],
    es: ['una', 'uno', 'los', 'las', 'para', 'con', 'jugador', 'juego', 'esta'],
    de: ['der', 'die', 'das', 'und', 'ist', 'sind', 'spieler', 'spiel', 'nicht'],
    fr: ['une', 'des', 'les', 'avec', 'pour', 'joueur', 'jeu', 'est', 'sont'],
  };
  const scores = Object.entries(słowa).map(([language, terms]) => ({
    language,
    score: terms.reduce((sum, term) => sum + (new RegExp(`(?:^| )${term}(?: |$)`, 'u').test(text) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1]?.score || 0;
  return { language: best.score >= 3 && best.score - second >= 2 ? best.language : 'unknown', confidence: best.score - second };
}

function sourceLanguageCompatible(source, question, routing = {}) {
  const declaredLanguage = String(routing.language || '').toLowerCase().split(/[-_]/u)[0];
  const questionLanguage = declaredLanguage && declaredLanguage !== 'unknown'
    ? declaredLanguage
    : wykryjJezykTekstu(question).language;
  if (questionLanguage !== 'pl') return true;
  const sourceText = [source.title, source.content].filter(Boolean).join(' ');
  const detected = wykryjJezykTekstu(sourceText);
  // Angielski jest akceptowany jako język źródłowy dla polskiego pytania.
  // Blokujemy tylko mocno rozpoznany język trzeci, który powodował fałszywe
  // konflikty PL↔PT w walidatorze.
  return detected.language === 'unknown' || detected.language === 'pl' || detected.language === 'en';
}

function similarity(a, b) {
  const aa = new Set(tokens([a.title, a.content].join(' ')));
  const bb = new Set(tokens([b.title, b.content].join(' ')));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const t of aa) if (bb.has(t)) common++;
  return common / new Set([...aa, ...bb]).size;
}

function diversifySources(scored, options = {}) {
  const max = Math.max(1, Number(options.maxSources) || 6);
  const minIndependent = Math.max(1, Number(options.minIndependent) || 2);
  const candidates = [...scored].sort((a,b) => b.coreScore - a.coreScore);
  const chosen = [];
  const hosts = new Set();

  for (const item of candidates) {
    if (chosen.length >= max) break;
    const duplicate = chosen.some(prev =>
      item.key === prev.key || (similarity(item, prev) >= 0.86 && item.host === prev.host)
    );
    if (duplicate) continue;
    chosen.push(item);
    if (item.host) hosts.add(item.host);
  }

  // If we have enough genuinely independent hosts, stop. Otherwise use the
  // highest-quality remaining source even when the host repeats.
  if (hosts.size < minIndependent && chosen.length < max) {
    for (const item of candidates) {
      if (chosen.length >= max) break;
      if (chosen.some(x => x.key === item.key)) continue;
      chosen.push(item);
      if (item.host) hosts.add(item.host);
      if (hosts.size >= minIndependent) break;
    }
  }
  return chosen;
}

function buildRetrievalPlan(question, routing = {}, options = {}) {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  if (!q || routing.needs_web === false) return [];

  const entity = String(routing.resolved_entity?.name || routing.entity || routing.game || '').trim();
  const game = String(routing.game || routing.resolved_entity?.game || '').trim();
  const requestedCharacters = CHARACTER_ALIASES.filter(entry =>
    [entry.name, ...(entry.aliases || [])].some(alias => containsAlias(q, alias))
  );
  const base = [];
  const add = (x, reason = 'primary') => {
    const v = String(x || '').replace(/\s+/g, ' ').trim();
    if (v.length < 8) return;
    const key = normalize(v);
    if (!base.some(x => normalize(x.query) === key)) base.push({ query:v, reason });
  };

  add(q);
  if (requestedCharacters.length) {
    // Gdy router zwraca tytuł gry jako entity, zapytanie entity+question
    // powiela treść pytania. Zastępujemy je krótkim, encyjnie zakotwiczonym
    // zapytaniem, które lepiej trafia w artykuły o konkretnych postaciach.
    const characterNames = requestedCharacters.slice(0, 4).map(entry => entry.name);
    const topic = /\b(?:dlaczego|czemu|powod|przyczyn|why|reason|cause|motivation)\b/iu.test(q)
      ? 'reason cause motivation story'
      : /\b(?:kiedy|when|rok|data|date|timeline)\b/iu.test(q)
        ? 'timeline date story'
        : /\b(?:gdzie|where|lokalizac|location)\b/iu.test(q)
          ? 'location story'
          : 'story plot lore';
    add(\`\${characterNames.join(' ')} \${game || entity} \${topic}\`, 'character');
  } else if (entity) {
    add(\`\${entity} \${q}\`);
  }
  if (game && game !== entity) add(\`\${game} \${q}\`);

  if (routing.is_lore) {
    add(`${game || entity || q} lore plot canon story`, 'lore');
    add(`${game || entity || q} character relationship story`, 'lore');
  }
  if (routing.is_gameplay) {
    add(`${game || entity || q} walkthrough guide solution`, 'gameplay');
    add(`${game || entity || q} quest mission guide`, 'gameplay');
  }
  if (routing.freshness === 'live') add(`${entity || game || q} latest official`);
  if (routing.freshness === 'recent') add(`${entity || game || q} latest news`);

  const max = Math.max(1, Math.min(5, Number(options.maxQueries) || 4));
  return base.slice(0, max).map((x, i) => ({
    query:x.query,
    priority:i === 0 ? 'primary' : i === 1 ? 'secondary' : 'fallback',
    reason:x.reason,
  }));
}

function czyStreszczenieModelu(source) {
  return /^gemini/i.test(String(source?.provider || ''));
}

function assessEvidence(results = [], question, routing = {}) {
  const normalized = (Array.isArray(results) ? results : [])
    .filter(Boolean)
    .map((source, index) => normalizeSource(source, index))
    .filter(source => sourceMatchesRequestContext(source, routing, question))
    .filter(source => sourceLanguageCompatible(source, question, routing))
    .map((s, index) => scoreSource(s, question, {
      index,
      // Score against both the resolved character/item and its parent game.
      // A game name must not shadow a more specific entity mention.
      entities: [
        routing.resolved_entity?.name,
        routing.entity,
        routing.game,
        routing.resolved_entity?.game,
      ],
      freshness: routing.freshness,
    }));

  const unique = [];
  const seen = new Set();
  for (const item of normalized.sort((a,b) => b.coreScore - a.coreScore)) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    unique.push(item);
  }

  const selected = diversifySources(unique, {
    maxSources: routing.is_lore || routing.is_gameplay ? 6 : 5,
    minIndependent: routing.is_lore || routing.is_gameplay ? 2 : 1,
  });

  const hosts = new Set(selected.map(x => x.host).filter(Boolean));
  const independentHosts = new Set(selected.filter(x => !czyStreszczenieModelu(x)).map(x => x.host).filter(Boolean));
  const strong = selected.filter(x => x.coreScore >= 0.55);
  const relevant = selected.filter(x => x.relevance >= 0.35 || x.titleRelevance >= 0.45);

  // Niezależne potwierdzenie musi pochodzić ze źródeł trafnych. Wcześniej nietrafne źródło
  // z drugiej domeny wystarczało, żeby „weak” zamienić w „usable”/„strong”.
  // „Źródła” z Gemini grounding to wycinki odpowiedzi modelu z przypisanym URL-em, a nie tekst
  // strony. Mogą być trafne, ale nie są niezależnym potwierdzeniem.
  const independent = x => !czyStreszczenieModelu(x);
  const strongIndependent = strong.filter(independent);
  const relevantIndependent = relevant.filter(independent);
  const evidenceHosts = new Set([...strongIndependent, ...relevantIndependent].map(x => x.host).filter(Boolean));
  // Jeden mocny, tematycznie trafny materiał pierwotny może wystarczyć do odpowiedzi
  // z obowiązkową walidacją. Nie udajemy wtedy niezależnego potwierdzenia z dwóch domen.
  const singlePrimarySource = strongIndependent.some(source =>
    source.authority === 'official'
    && source.coreScore >= 0.62
    && (source.relevance >= 0.35 || source.titleRelevance >= 0.45)
  );

  let status = 'weak';
  if (strongIndependent.length >= 2 && evidenceHosts.size >= 2 && relevantIndependent.length >= 2) status = 'strong';
  else if (singlePrimarySource || (strongIndependent.length >= 1 && relevantIndependent.length >= 1 && evidenceHosts.size >= 2)) status = 'usable';

  return {
    status,
    sources: selected,
    sourceCount: selected.length,
    independentHosts: independentHosts.size,
    uniqueHosts: hosts.size,
    relevantHosts: evidenceHosts.size,
    modelSummarySources: selected.filter(czyStreszczenieModelu).length,
    strongSources: strong.length,
    relevantSources: relevant.length,
    relevantIndependentSources: relevantIndependent.length,
    singlePrimarySource,
    coverageScore: Number(Math.min(1,
      relevantIndependent.length / (routing.is_lore || routing.is_gameplay ? 3 : 2)
    ).toFixed(3)),
  };
}

function decideEvidencePolicy(evidence, routing = {}) {
  const factual = Boolean(
    ['web_fact','hltb','youtube','weather'].includes(routing.intent) ||
    routing.is_lore || routing.is_gameplay || routing.needs_fresh_data
  );

  if (!factual) return { mode:'optional', canGenerate:true, requireValidator:false };
  if (!evidence || evidence.status === 'weak') {
    return {
      mode:'insufficient',
      canGenerate:true,
      requireValidator:true,
      mustAllowPartial:true,
      forbidUnsupportedFacts:true,
    };
  }
  return {
    mode:evidence.status,
    canGenerate:true,
    requireValidator:true,
    mustAllowPartial:true,
    forbidUnsupportedFacts:true,
  };
}

module.exports = {
  normalize,
  tokens,
  hostOf,
  canonicalUrl,
  classifyAuthority,
  AUTHORITY_ALIASES,
  normalizeSource,
  scoreSource,
  similarity,
  diversifySources,
  buildRetrievalPlan,
  assessEvidence,
  sourceMatchesRequestContext,
  cleanWikiMarkup,
  wykryjJezykTekstu,
  sourceLanguageCompatible,
  decideEvidencePolicy,
};