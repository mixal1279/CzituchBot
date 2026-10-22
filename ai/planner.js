'use strict';

const SOURCE_POLICIES = {
  lore: { preferred: ['official', 'gamelore', 'specialized_wiki', 'reputable_guide'], fallback: ['ign', 'gamespot', 'pcgamer', 'eurogamer', 'fandom'] },
  gameplay: { preferred: ['official', 'gamefaqs', 'specialized_wiki'], fallback: ['ign', 'gamespot', 'pcgamer', 'fandom'] },
  hltb: { preferred: ['hltb'], fallback: [] },
  minecraft_recipe: { preferred: ['local_minecraft_data'], fallback: ['minecraft.wiki'] },
  weather: { preferred: ['weather_api'], fallback: [] },
  youtube: { preferred: ['youtube_api'], fallback: ['twitchtracker', 'twitch'] },
  web_fact: { preferred: ['official', 'specialized', 'reputable'], fallback: ['general_web'] },
  conversation: { preferred: [], fallback: [] },
};

// Tokeny są normalizowane (bez ogonków), więc stopwordy też — inaczej „może”, „można” nigdy nie pasują.
const QUERY_STOPWORDS = new Set([
  'czy', 'jak', 'jaki', 'jaka', 'jakie', 'co', 'czym', 'kto', 'kim', 'kiedy',
  'gdzie', 'ile', 'dlaczego', 'jest', 'są', 'to', 'ten', 'ta', 'te', 'do', 'na',
  'w', 'we', 'z', 'ze', 'o', 'od', 'po', 'dla', 'i', 'oraz', 'a', 'czyli',
  'może', 'mogę', 'można', 'się', 'mi', 'mnie', 'jego', 'jej', 'ich', 'tym',
  'tę', 'tą', 'być', 'ma', 'mają', 'miał', 'była', 'było', 'były',
].map(word => normalizujQueryToken(word)));

function normalizujQueryToken(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}'-]+/gu, '')
    .trim();
}

function slowaZapytania(question) {
  const tokens = String(question || '').match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [];
  return [...new Set(tokens.map(normalizujQueryToken)
    .filter(token => token.length >= 4 && !QUERY_STOPWORDS.has(token)))].slice(0, 14);
}

function dodajUnikalneQuery(lista, query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q || q.length < 8) return;
  const key = normalizujQueryToken(q);
  if (!lista.some(x => normalizujQueryToken(x) === key)) lista.push(q);
}

function buildRetrievalQueries(question, routing = {}, options = {}) {
  const original = String(question || '').replace(/\s+/g, ' ').trim();
  if (!original || routing?.needs_web === false) return [];

  const queries = [];
  const entity = String(routing?.resolved_entity?.name || routing?.entity || routing?.game || '').trim();
  const game = String(routing?.game || routing?.resolved_entity?.game || '').trim();
  const keywords = slowaZapytania(original);
  const normalizedEntity = normalizujQueryToken(entity);

  dodajUnikalneQuery(queries, original);

  if (entity && keywords.length) {
    const filtered = keywords.filter(k => !normalizedEntity.includes(k)).slice(0, 8);
    dodajUnikalneQuery(queries, [entity, ...(game && normalizujQueryToken(game) !== normalizedEntity ? [game] : []), ...filtered].join(' '));
  }

  // Add one intent-specific retrieval query. A generic "lore/guide" query
  // often retrieves pages about the game but misses the exact evidence slot
  // (location landmark, timeline/quest order, character identity, or causal link).
  const isWhereQuestion = /(?:^|\s)(?:gdzie|dok[aą]d|sk[aą]d|where)(?:\s|$)/iu.test(original);
  const isWhenQuestion = /(?:^|\s)(?:kiedy|when)(?:\s|$)|w jakim momencie|w którym momencie/iu.test(original);
  const isWhoQuestion = /(?:^|\s)(?:kim jest|kto jest|who is|who was)(?:\s|$)/iu.test(original);
  const isWhyQuestion = /(?:^|\s)(?:dlaczego|czemu|why)(?:\s|$)|z jakiego powodu/iu.test(original);

  if (isWhereQuestion) {
    dodajUnikalneQuery(queries, [entity, game, 'exact location landmark nearby map'].filter(Boolean).join(' '));
  } else if (isWhenQuestion) {
    dodajUnikalneQuery(queries, [entity, game, 'story timeline quest order arrival'].filter(Boolean).join(' '));
  } else if (isWhoQuestion) {
    dodajUnikalneQuery(queries, [entity, game, 'character identity background role companion lore'].filter(Boolean).join(' '));
  } else if (isWhyQuestion) {
    // Core transfer jest bardzo charakterystyczny dla wątku Portal 2/Wheatleya.
    // Dodawanie go do KAŻDEGO pytania „dlaczego” tworzy szum (np. wyniki Magic:
    // The Gathering dla pytania o Skyrim). Dobieramy termin tylko, gdy kontekst
    // pytania rzeczywiście wskazuje ten wątek; pozostałe pytania dostają neutralne,
    // ale tematycznie sensowne frazy do wyszukiwarki.
    const portalCoreTransferContext = /\b(?:portal\s*2|wheatley|glados|core\s+transfer|transfer\s+rdzenia|rdzen\w*)\b/iu.test([original, entity, game].join(' '));
    const causalHints = portalCoreTransferContext
      ? 'cause reason motivation event core transfer lore'
      : 'cause reason motivation story conflict lore';
    dodajUnikalneQuery(queries, [entity, game, causalHints].filter(Boolean).join(' '));
  } else if (routing?.is_lore) {
    dodajUnikalneQuery(queries, [entity || original, game, 'character history story lore'].filter(Boolean).join(' '));
  } else if (routing?.is_gameplay) {
    dodajUnikalneQuery(queries, [entity || original, game, 'gameplay strategy mechanics guide walkthrough'].filter(Boolean).join(' '));
  } else if (routing?.freshness === 'live') {
    dodajUnikalneQuery(queries, [entity, ...keywords.slice(0, 8), 'latest today'].filter(Boolean).join(' '));
  } else if (routing?.freshness === 'recent') {
    dodajUnikalneQuery(queries, [entity, ...keywords.slice(0, 8), 'latest'].filter(Boolean).join(' '));
  }

  const maxQueries = Math.max(1, Math.min(Number(options.maxQueries) || 3, 4));
  return queries.slice(0, maxQueries);
}

const RESPONSE_PROFILES = {
  simple: { maxSentences: 2, maxWords: 60, maxTokens: 220 },
  comparison: { maxSentences: 4, maxWords: 110, maxTokens: 360 },
  lore: { maxSentences: 3, maxWords: 120, maxTokens: 420 },
  gameplay: { maxSentences: 4, maxWords: 140, maxTokens: 520 },
  timeline: { maxSentences: 5, maxWords: 150, maxTokens: 560 },
  technical: { maxSentences: 6, maxWords: 160, maxTokens: 600 },
  chat: { maxSentences: 3, maxWords: 90, maxTokens: 300 },
};

function detectResponseProfile(question, routing) {
  const p = String(question || '').toLocaleLowerCase('pl-PL');
  if (routing?.is_gameplay) return 'gameplay';
  if (routing?.is_lore) return /(?<![\p{L}\p{N}_])(?:timeline|chronolog\p{L}*|kolejno[śs][ćc]\p{L}*|oś czasu|os czasu)(?![\p{L}\p{N}_])/iu.test(p) ? 'timeline' : 'lore';
  // Rdzenie ze słowem odmienionym (porównaj, różni się, różnica) — `\b` po rdzeniu nigdy nie pasował.
  if (/(?<![\p{L}\p{N}_])(?:porówn\p{L}*|porown\p{L}*|różnic\p{L}*|roznic\p{L}*|różni\p{L}*|rozni\p{L}*|vs\.?|versus|lepsz\p{L}*)(?![\p{L}\p{N}_])/iu.test(p)) return 'comparison';
  if (/\b(?:kod|api|oauth|docker|node\.?js|javascript|python|program|serwer|błąd|blad|error|config|konfigurac)\b/i.test(p)) return 'technical';
  if (routing?.intent === 'conversation') return 'chat';
  return 'simple';
}

function buildSourcePolicy(routing, responseProfile) {
  const key = routing?.is_lore ? 'lore' : routing?.is_gameplay ? 'gameplay' : routing?.intent || 'web_fact';
  const policy = SOURCE_POLICIES[key] || SOURCE_POLICIES.web_fact;
  return { ...policy, responseProfile, requireEvidence: ['lore', 'gameplay', 'web_fact', 'youtube', 'hltb'].includes(key), freshness: routing?.freshness || 'evergreen' };
}

function planAIRequest(question, routing) {
  const responseProfile = detectResponseProfile(question, routing);
  return {
    intent: routing?.intent || 'conversation',
    entity: routing?.entity || null,
    entityType: routing?.entityType || null,
    game: routing?.game || null,
    freshness: routing?.freshness || 'evergreen',
    needsWeb: Boolean(routing?.needs_web),
    needsFreshData: Boolean(routing?.needs_fresh_data),
    sourceType: routing?.source_type || 'none',
    responseProfile,
    sourcePolicy: buildSourcePolicy(routing, responseProfile),
    retrievalTimeRange: routing?.freshness === 'live' ? 'day' : routing?.freshness === 'recent' ? 'week' : null,
    retrievalQueries: buildRetrievalQueries(question, routing),
    claimsRequired: ['lore', 'gameplay'].includes(responseProfile) ? 'claim_by_claim' : 'normal',
  };
}

function responseContract(profile) {
  const cfg = RESPONSE_PROFILES[profile] || RESPONSE_PROFILES.simple;
  return [
    'FORMAT ODPOWIEDZI: maksymalnie ' + cfg.maxSentences + ' zdań i około ' + cfg.maxWords + ' słów.',
    'Zawsze kończ pełne zdania i odpowiadaj bezpośrednio na pytanie, zanim dodasz kontekst.',
    'Jeśli materiał pozwala odpowiedzieć częściowo, odpowiedz na potwierdzoną część zamiast automatycznie odmawiać.',
    'Nie zastępuj odpowiedzi ogólnym komunikatem o braku danych, jeśli źródła zawierają odpowiedź na pytanie.',
    'Każde zdanie musi mieć bezpośrednie oparcie w źródłach: pomiń niepotwierdzone szczegóły zamiast dopisywać zdania o braku danych albo domysły — walidator odrzuca całą odpowiedź, jeśli choć jedno zdanie nie ma pokrycia.',
    'Zachowuj dokładny zakres źródła: opis konkretnego bossa, postaci, zadania lub wersji gry nie dowodzi, że ta sama reguła dotyczy wszystkich wrogów albo całej gry. Nazwij opisywany przypadek w odpowiedzi; nie uogólniaj go bez osobnego dowodu.',
    'Zachowuj niepewność źródła: „I think”, „I do not think”, „may”, „possibly” i ich odpowiedniki nie są kategorycznym potwierdzeniem. Nie zamieniaj opinii ani przypuszczenia w fakt; pomiń szczegół albo wyraźnie zachowaj zastrzeżenie.',
    'Jeśli metadane requestu jednoznacznie podają grę i jest ona potrzebna do odróżnienia kontekstu, nazwij grę w odpowiedzi. Nie zastępuj tym jednak dowodu dla konkretnego faktu.',
    'Nie dodawaj metakomentarzy typu „źródło potwierdza”, nie cytuj ponownie źródeł w treści odpowiedzi i nie dopisuj końcowego podsumowania, które powtarza poprzednie zdanie. Odpowiadaj bezpośrednio na pytanie, wyłącznie potrzebnymi faktami.',
    'Dla pytań gameplay podawaj kolejność działań, jeśli jest potrzebna do wykonania zadania.',
    'Dla pytań lore nie dopowiadaj spoilerów, których nie wymaga pytanie; gdy występuje interpretacja lub niepewność, oznacz ją wprost.',
    'Oddzielaj fakty potwierdzone przez źródła od interpretacji i nie przedstawiaj interpretacji jako kanonu.'
  ].join('\n');
}

// Rewrite zapytania modelem (Groq 20b) kosztuje wywołanie i tokeny z dziennego limitu, a pomaga
// głównie wtedy, gdy pytanie zależy od poprzedniej wymiany („a on?”, „co z nią?”). Bez kontekstu
// i z rozpoznaną grą/encją pytanie jest już samodzielne.
function czyPotrzebujeRewrite(pytanie, { hasContext = false, hasEntity = false } = {}) {
  const q = String(pytanie || '').trim();
  if (!q) return false;
  const words = q.split(/\s+/).length;
  if (hasContext) {
    const anaphora = /(?<![\p{L}])(?:on|ona|ono|oni|one|jego|jej|ich|tam|tego|tej|tych|tym|ten|ta|wtedy|wcześniej|a\s+co\s+z)(?![\p{L}])/iu.test(q);
    return anaphora || words <= 5;
  }
  return !hasEntity && (q.length > 160 || words >= 25);
}

module.exports = { czyPotrzebujeRewrite, SOURCE_POLICIES, RESPONSE_PROFILES, detectResponseProfile, buildSourcePolicy, buildRetrievalQueries, planAIRequest, responseContract };
