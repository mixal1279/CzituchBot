'use strict';

const { scoreSource: scoreCoreSource, diversifySources: diversifyCoreSources } = require('./core');

const fs = require('fs');
const { resolveGameEntity, normalizujEncje } = require('./entities');
const { AI_MODELS } = require('./modelConfig');
const { searchSecondaryProviders, formatSources } = require('./webRetrieval');
const { sanitizeUntrustedText } = require('./untrustedText');

const TAVILY_CACHE_TTL_MS = 10 * 60 * 1000; // domyślne / pytania o świeże wiadomości
const TAVILY_REWRITE_TTL_MS = 6 * 60 * 60 * 1000;
const TAVILY_PERSIST_DEBOUNCE_MS = 5000;
const TAVILY_CACHE_MAX_ENTRIES = 300;
const TAVILY_CACHE_MAX_BYTES = 700 * 1024; // poniżej limitu 1 MiB pojedynczego dokumentu Firestore
const TAVILY_REWRITE_MAX_ENTRIES = 500;
const TAVILY_CACHE_VERSION = 2;
const TAVILY_REWRITE_CACHE_VERSION = 1;
const TAVILY_MIN_SCORE = Number(process.env.TAVILY_MIN_SCORE) || 0.2;
const TAVILY_MIN_STRONG_RESULTS = 1;

// TTL zależny od tego, jak szybko odpowiedź się starzeje: świeże wiadomości krótko,
// fakty historyczne (bez time_range) długo.
function przesunSourceIdsTavily(text, offset = 0) {
  const n = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
  if (!n) return String(text || '');
  return String(text || '').replace(/\[SOURCE\s+(\d+)\]/g, (_, id) => '[SOURCE ' + (Number(id) + n) + ']');
}

function ograniczCacheTavily(cache, maxEntries = TAVILY_CACHE_MAX_ENTRIES) {
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  return cache;
}

function snapshotCacheTavily(cache, maxBytes = TAVILY_CACHE_MAX_BYTES) {
  const entries = [...cache.entries()];
  let snapshot = { version: TAVILY_CACHE_VERSION, entries: Object.fromEntries(entries) };
  let serialized = JSON.stringify(snapshot);
  while (Buffer.byteLength(serialized, 'utf8') > maxBytes && entries.length) {
    entries.shift();
    snapshot = { version: TAVILY_CACHE_VERSION, entries: Object.fromEntries(entries) };
    serialized = JSON.stringify(snapshot);
  }
  return serialized;
}

function serializedCacheEntryBytes(key, value) {
  // Size of one JSON object property, excluding the surrounding braces.
  return Buffer.byteLength(JSON.stringify({ [key]: value }), 'utf8') - 2;
}

function ograniczCacheRewrite(cache, maxBytes = TAVILY_CACHE_MAX_BYTES) {
  const entrySizes = new Map();
  let serializedBytes = 2; // "{}"
  for (const [key, value] of cache) {
    const bytes = serializedCacheEntryBytes(key, value);
    entrySizes.set(key, bytes);
    serializedBytes += bytes;
  }
  serializedBytes += Math.max(0, cache.size - 1); // commas between properties

  while (cache.size > TAVILY_REWRITE_MAX_ENTRIES || (cache.size && serializedBytes > maxBytes)) {
    const oldestKey = cache.keys().next().value;
    serializedBytes -= entrySizes.get(oldestKey) || 0;
    if (cache.size > 1) serializedBytes -= 1;
    cache.delete(oldestKey);
    entrySizes.delete(oldestKey);
  }
  return Object.fromEntries(cache);
}

function snapshotCacheRewrite(cache, maxBytes = TAVILY_CACHE_MAX_BYTES) {
  const entries = [...cache.entries()];
  const selectedNewestFirst = [];
  // Account for the versioned envelope once, then add each entry's serialized
  // size once. Avoid repeatedly stringifying the entire snapshot on the event loop.
  let serializedBytes = Buffer.byteLength(JSON.stringify({
    version: TAVILY_REWRITE_CACHE_VERSION,
    entries: {},
  }), 'utf8');

  for (let i = entries.length - 1; i >= 0; i--) {
    const [key, value] = entries[i];
    const propertyBytes = serializedCacheEntryBytes(key, value);
    const addedBytes = propertyBytes + (selectedNewestFirst.length ? 1 : 0);
    if (serializedBytes + addedBytes > maxBytes) continue;
    selectedNewestFirst.push([key, value]);
    serializedBytes += addedBytes;
  }

  selectedNewestFirst.reverse();
  return JSON.stringify({
    version: TAVILY_REWRITE_CACHE_VERSION,
    entries: Object.fromEntries(selectedNewestFirst),
  });
}

function parseRewriteCacheEntries(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  if (Buffer.byteLength(JSON.stringify(saved), 'utf8') > TAVILY_CACHE_MAX_BYTES) return null;
  let entries;
  if (Number.isInteger(saved.version)) {
    if (saved.version !== TAVILY_REWRITE_CACHE_VERSION) return null;
    entries = saved.entries;
  } else {
    // Read old unversioned cache files during migration; every new write is versioned.
    entries = saved;
  }
  return entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : null;
}

function ttlDlaZakresu(timeRange) {
  const r = String(timeRange || '').replace(/^past_/, '').toLowerCase();
  if (!r) return 6 * 60 * 60 * 1000;
  if (['day', 'd', 'week', 'w'].includes(r)) return TAVILY_CACHE_TTL_MS;
  return 60 * 60 * 1000;
}

// Nie traktujemy dwóch słabych wyników jako dowodu. Jeśli Tavily zwraca score,
// materiał trafia dalej tylko wtedy, gdy istnieje co najmniej jeden sensowny wynik.
// Przy braku score zachowujemy wyniki, bo API nie dostarczyło nam sygnału jakości.
function filtrujPoScore(results, minScore = TAVILY_MIN_SCORE) {
  const lista = Array.isArray(results) ? results : [];
  if (!lista.length || !lista.every(r => typeof r?.score === 'number')) {
    return { kept: lista, dropped: 0, lowConfidence: false };
  }
  const sorted = [...lista].sort((a, b) => b.score - a.score);
  const strong = sorted.filter(r => r.score >= minScore);
  if (strong.length < TAVILY_MIN_STRONG_RESULTS) {
    return { kept: [], dropped: lista.length, lowConfidence: true };
  }
  return { kept: strong.slice(0, 7), dropped: lista.length - Math.min(strong.length, 7), lowConfidence: false };
}


// Lekka redukcja szumu: nie wymaga embeddingów ani dodatkowego requestu AI.
// Używa rdzeni słów, dzięki czemu np. „Wiedźminie” pasuje do „Wiedźmin”.
const STOP_SLOWA_TAVILY = new Set([
  'czy', 'jak', 'jaki', 'jaka', 'jakie', 'co', 'czym', 'kto', 'kim', 'kiedy',
  'gdzie', 'ile', 'dlaczego', 'jest', 'są', 'to', 'ten', 'ta', 'te', 'do', 'na',
  'w', 'we', 'z', 'ze', 'o', 'od', 'po', 'dla', 'i', 'oraz', 'a', 'czyli',
  'może', 'mogę', 'można', 'się', 'mi', 'mnie', 'jego', 'jej', 'ich', 'tym',
  'tę', 'ten', 'tą', 'być', 'ma', 'mają', 'miał', 'była', 'było', 'były',
]);

function normalizujTokenTavily(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, '')
    .trim();
}

function slowaKluczoweTavily(pytanie) {
  const tokens = String(pytanie || '').match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [];
  return [...new Set(tokens.map(normalizujTokenTavily)
    .filter(t => t.length >= 4 && !STOP_SLOWA_TAVILY.has(t))
    .map(t => t.length >= 6 ? t.slice(0, 6) : t))].slice(0, 18);
}

function sanityzujTrescZrodlaTavily(material) {
  return sanitizeUntrustedText(material);
}

function filtrujMaterialPoSlowachTavily(material, pytanie) {
  const text = String(material || '').trim();
  const keywords = slowaKluczoweTavily(pytanie);
  if (!text || keywords.length < 1) return text;

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length <= 2) return text;

  const scored = sentences.map((sentence, index) => {
    const normalized = normalizujTokenTavily(sentence);
    let score = 0;
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) score += keyword.length >= 6 ? 2 : 1;
    }
    // Pierwsze zdanie często identyfikuje obiekt strony; zachowujemy je przy remisie.
    if (index === 0) score += 0.25;
    return { sentence, score, index };
  });

  const relevant = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  // Heurystyka nie może wyzerować źródła: gdy nic nie pasuje, zwracamy pełny materiał.
  if (!relevant.length) return text;

  const keep = relevant.slice(0, 10).sort((a, b) => a.index - b.index).map(x => x.sentence);
  // Jeżeli filtr wyciął prawie wszystko, zostawiamy jeszcze jedno zdanie kontekstowe.
  if (keep.length < 2 && sentences.length > 1) keep.push(sentences.find(s => !keep.includes(s)) || '');
  return keep.filter(Boolean).join(' ');
}

function poziomAutorytetuTavily(url, requestedDomains = []) {
  const quality = ocenaZrodlaLokalnie(url, requestedDomains);
  if (quality === 'oficjalne') return 4;
  if (quality === 'wyspecjalizowane') return 3;
  if (quality === 'guide/referencyjne') return 2;
  if (quality === 'zewnętrzne-niezweryfikowane') return 1;
  return 0;
}

function dataZrodlaTavily(result) {
  const raw = result?.published_date || result?.publishedDate || result?.date || result?.updated_date || result?.updatedDate;
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : null;
}

function wykryjKonfliktyZrodelTavily(results, sourceQuestion, requestedDomains = []) {
  const lista = Array.isArray(results) ? results : [];
  const konflikty = [];
  const questionKeywords = slowaKluczoweTavily(sourceQuestion).filter(k => k.length >= 5);
  const evidence = lista.map((r, index) => {
    const text = String(r?.content || '').replace(/\s+/g, ' ').trim();
    const numbers = [...new Set((text.match(/\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?\s*(?:godzin|h|min|dni|lat|%|GB|MB)\b/gi) || []).map(x => x.toLowerCase()))];
    const negated = /\b(?:nie|nigdy|brak|nie jest|nie był|nie była|nie zosta[łl]|false|no)\b/i.test(text);
    const haystack = normalizujTokenTavily([r?.title, text].filter(Boolean).join(' '));
    const topical = !questionKeywords.length || questionKeywords.filter(k => haystack.includes(k)).length >= Math.min(1, questionKeywords.length);
    return {
      index, id: `SOURCE ${index + 1}`,
      host: (() => { try { return new URL(r.url).hostname; } catch (_) { return '(nieznany host)'; } })(),
      authority: poziomAutorytetuTavily(r?.url, requestedDomains), date: dataZrodlaTavily(r),
      numbers, negated, topical, text: text.slice(0, 900),
    };
  }).filter(x => x.topical);
  for (let i = 0; i < evidence.length; i++) {
    for (let j = i + 1; j < evidence.length; j++) {
      const a = evidence[i], b = evidence[j];
      const differingNumbers = a.numbers.length && b.numbers.length &&
        a.numbers.some(x => b.numbers.every(y => y !== x)) &&
        b.numbers.some(x => a.numbers.every(y => y !== x));
      const opposingNegation = a.negated !== b.negated && (a.numbers.length || b.numbers.length);
      if (!differingNumbers && !opposingNegation) continue;
      const winner = a.authority !== b.authority
        ? (a.authority > b.authority ? a : b)
        : ((a.date || 0) !== (b.date || 0) ? ((a.date || 0) > (b.date || 0) ? a : b) : null);
      konflikty.push({
        sources: [a.id, b.id], type: differingNumbers ? 'different_numeric_or_date_claims' : 'opposing_negation',
        preferred: winner?.id || null,
        reason: winner ? `Preferuj ${winner.id} (${winner.host}) ze względu na wyższy autorytet/świeżość; drugi wynik traktuj jako sprzeczny.` : 'Źródła mają podobny autorytet i brak rozstrzygającej daty — nie wybieraj arbitralnie.',
      });
    }
  }
  return konflikty.slice(0, 8);
}

function zbudujRaportKonfliktowTavily(conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return '';
  return [
    '[SOURCE_CONFLICTS]',
    'Wykryto potencjalnie sprzeczne fragmenty źródeł.',
    ...conflicts.map(c => `- ${c.sources.join(' vs ')} | typ=${c.type} | preferowane=${c.preferred || 'BRAK'} | ${c.reason}`),
    'ZASADA: konflikt bez jednoznacznego rozstrzygnięcia oznacza brak pewnego dowodu; nie zgaduj.',
    '[/SOURCE_CONFLICTS]',
  ].join('\n');
}
function sygnalyClaimuTavily(sourceQuestion) {
  const text = String(sourceQuestion || '');
  const relation = (text.match(/\b(?:dlaczego|czemu|powod|ponieważ|bo|zdradził|zdradziła|pokonał|pokonała|przejął|przejęła|zabił|zabiła|uratował|uratowała|wydał|wydana|premiera|data|ile|kiedy|gdzie|jak)\w*\b/giu) || [])
    .map(normalizujTokenTavily);
  const numbers = (text.match(/\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?%?\b/g) || []).map(normalizujTokenTavily);
  return [...new Set([...relation, ...numbers].filter(Boolean))].slice(0, 8);
}

function claimCoverageTavily(result, signals) {
  if (!signals.length) return 0;
  const haystack = normalizujTokenTavily([result?.title, result?.content].filter(Boolean).join(' '));
  return signals.filter(signal => haystack.includes(signal)).length / signals.length;
}

function rerankujWynikiTavily(results, sourceQuestion, requestedDomains = [], options = {}) {
  const input = Array.isArray(results) ? results : [];
  const resolvedEntity = resolveGameEntity(sourceQuestion);
  const entity = resolvedEntity?.game || resolvedEntity?.name || null;
  const claimSignals = sygnalyClaimuTavily(sourceQuestion);

  const candidates = input.map((result, index) => {
    const localQuality = ocenaZrodlaLokalnie(result?.url, requestedDomains);
    const core = scoreCoreSource({
      ...result,
      authority: localQuality,
    }, sourceQuestion, {
      entity,
      freshness: options.freshness,
    });

    const claimCoverage = claimCoverageTavily(result, claimSignals);
    const claimBonus = Math.min(0.16, claimCoverage * 0.16);
    const requestedBonus = requestedDomains?.length && requestedDomains.some(d => {
      try {
        const host = new URL(result?.url).hostname.toLowerCase().replace(/^www\./, '');
        const clean = String(d).toLowerCase().replace(/^www\./, '');
        return host === clean || host.endsWith('.' + clean);
      } catch (_) { return false; }
    }) ? 0.10 : 0;

    const base = typeof result?.score === 'number' ? result.score : 0;
    const rerankScore = Math.max(0, Math.min(1.5,
      base * 0.35 +
      core.coreScore * 0.55 +
      claimBonus +
      requestedBonus
    ));

    return {
      ...result,
      _coreScore: core.coreScore,
      _rerankScore: rerankScore,
      _host: core.host,
      _key: core.key,
      _index: index,
    };
  });

  const sorted = candidates.sort((a,b) => b._rerankScore - a._rerankScore);
  const selected = [];
  const hosts = new Set();
  const maxSources = Math.max(1, input.length);
  const minIndependent = Math.min(2, input.length);

  for (const item of sorted) {
    if (selected.length >= maxSources) break;
    if (selected.some(prev => prev._key === item._key)) continue;
    if (item._host && hosts.has(item._host) && hosts.size < minIndependent) continue;
    selected.push(item);
    if (item._host) hosts.add(item._host);
  }

  for (const item of sorted) {
    if (selected.length >= maxSources) break;
    if (selected.some(prev => prev._key === item._key)) continue;
    selected.push(item);
  }

  return selected.map(({_coreScore,_rerankScore,_host,_key,_index,...result}) => result);
}

function ocenaZrodlaLokalnie(url, requestedDomains = []) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const requested = requestedDomains.some(d => {
      const clean = String(d || '').toLowerCase().replace(/^www\./, '');
      return clean && (host === clean || host.endsWith('.' + clean));
    });
    const official = ['minecraft.net', 'rockstargames.com', 'thewitcher.com', 'playstation.com', 'naughtydog.com', 'bandainamcoent.com', 'larian.com', 'baldursgate3.game', 'nvidia.com', 'openai.com', 'anthropic.com', 'microsoft.com', 'apple.com', 'discord.com', 'twitch.tv', 'kick.com']
      .some(d => host === d || host.endsWith('.' + d));
    const specialized = ['minecraft.wiki', 'gamelore.fandom.com', 'steamdb.info', 'gamefaqs.gamespot.com', 'developer.mozilla.org']
      .some(d => host === d || host.endsWith('.' + d));
    const guide = ['ign.com', 'gamespot.com', 'pcgamer.com', 'fandom.com', 'eurogamer.net', 'eurogamer.pl']
      .some(d => host === d || host.endsWith('.' + d));
    if (official) return 'oficjalne';
    if (specialized || requested) return 'wyspecjalizowane';
    if (guide) return 'guide/referencyjne';
    return 'zewnętrzne-niezweryfikowane';
  } catch (_) { return 'nieznane'; }
}

const TAVILY_BLOKOWANE_HOSTY = new Set([
  'forums.gamespot.com', 'community.gamespot.com',
  'answers.ign.com', 'forums.ign.com',
]);

function hostnamePasujeDoDomenyTavily(url, domains) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return (domains || []).some(d => {
      const domain = String(d || '').toLowerCase().replace(/^www\./, '');
      return host === domain || host.endsWith(`.${domain}`);
    });
  } catch (_) { return false; }
}

function czyWymagaSecondaryRetrieval(results, sourceQuestion = '', timeRange = null) {
  const lista = Array.isArray(results) ? results : [];
  if (lista.length === 0) return true;
  if (lista.length >= 2) {
    const hosts = new Set(lista.map(r => { try { return new URL(r?.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } }).filter(Boolean));
    const providers = new Set(lista.map(r => String(r?.provider || 'tavily')).filter(Boolean));
    const strong = lista.filter(r => typeof r?.score !== 'number' || r.score >= 0.55).length;
    if (strong >= 1 && (hosts.size >= 2 || providers.size >= 2)) return false;
    return true;
  }

  const bestScore = typeof lista[0]?.score === 'number' ? lista[0].score : null;
  if (bestScore !== null && bestScore < 0.55) return true;

  // Świeże dane wymagają niezależnego potwierdzenia przy pojedynczym wyniku.
  if (timeRange) return true;

  // Dla pytań faktograficznych/lore/gameplay pojedyncze źródło jest słabszym
  // dowodem niż dla prostego zapytania nawigacyjnego.
  return /\b(?:dlaczego|czemu|kto|kim|kiedy|ile|czy|jak(?: działa| zrob| przejść| przejsc| pokonać| pokonac))\b/i.test(String(sourceQuestion));
}

function czyZablokowanyHostTavily(url) {
  try { return TAVILY_BLOKOWANE_HOSTY.has(new URL(url).hostname.toLowerCase().replace(/^www\./, '')); }
  catch (_) { return true; }
}

function createTavilySearch({ apiKey, groq, fetchZTimeout, normalizeQuery, logger = console, onStatus = () => {}, cacheFile = './tavily_cache.json', stateStore = null, geminiKey = process.env.GEMINI_API_KEY, exaKey = process.env.EXA_API_KEY }) {
  const cache = new Map();
  const inFlight = new Map();
  let persistQueue = Promise.resolve();
  try {
    const stat = fs.statSync(cacheFile);
    if (stat.size <= TAVILY_CACHE_MAX_BYTES) {
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const entries = saved?.version === TAVILY_CACHE_VERSION ? saved.entries : saved;
      if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
        for (const [key, value] of Object.entries(entries)) {
          if (typeof key !== 'string' || key.length > 2048) continue;
          if (!value || typeof value.wynik !== 'string' || value.wynik.length > 12000) continue;
          if (value.czas && Date.now() - value.czas < (value.ttl || TAVILY_CACHE_TTL_MS)) cache.set(key, value);
        }
      }
    } else {
      logger.warn?.(`[Tavily] cache pominięty — plik przekracza limit ${TAVILY_CACHE_MAX_BYTES} B`);
    }
  } catch (_) {}
  ograniczCacheTavily(cache);
  let cacheReadyPromise = null;
  let cacheReady = !stateStore?.enabled;
  let cacheRetryAfter = 0;
  async function ensureCacheReady() {
    if (!stateStore?.enabled || cacheReady) return true;
    if (cacheReadyPromise) return cacheReadyPromise;
    if (Date.now() < cacheRetryAfter) return false;
    cacheReadyPromise = (async () => {
      const [saved, rewriteSaved] = await Promise.all([
        stateStore.loadCache('tavily_search', cacheFile),
        stateStore.loadCache('tavily_rewrite', null),
      ]);
      const entries = saved?.version === TAVILY_CACHE_VERSION ? saved.entries : saved;
      const memoryEntries = [...cache.entries()];
      const memoryRewriteEntries = [...rewriteCache.entries()];
      cache.clear();
      if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
        for (const [key, value] of Object.entries(entries)) {
          if (typeof key !== 'string' || key.length > 2048) continue;
          if (!value || typeof value.wynik !== 'string' || value.wynik.length > 12000) continue;
          if (value.czas && Date.now() - value.czas < (value.ttl || TAVILY_CACHE_TTL_MS)) cache.set(key, value);
        }
      }
      // Merge entries created in memory during a Firestore outage; newer timestamps win.
      for (const [key, value] of memoryEntries) {
        const current = cache.get(key);
        if (!current || Number(value?.czas || 0) > Number(current?.czas || 0)) cache.set(key, value);
      }
      rewriteCache.clear();
      const rewriteEntries = parseRewriteCacheEntries(rewriteSaved);
      if (rewriteEntries) {
        for (const [key, value] of Object.entries(rewriteEntries)) {
          if (key.length <= 2048 && typeof value?.query === 'string' && value.query.length <= 2048
            && Number.isFinite(Number(value.czas)) && Date.now() - Number(value.czas) < TAVILY_REWRITE_TTL_MS) {
            rewriteCache.set(key, value);
          }
        }
      } else if (rewriteSaved != null) {
        logger.warn?.('[Tavily] rewrite cache z Firestore pominięty — nieprawidłowa wersja lub rozmiar.');
      }
      for (const [key, value] of memoryRewriteEntries) {
        const current = rewriteCache.get(key);
        if (!current || Number(value?.czas || 0) > Number(current?.czas || 0)) rewriteCache.set(key, value);
      }
      ograniczCacheTavily(cache);
      while (rewriteCache.size > TAVILY_REWRITE_MAX_ENTRIES) rewriteCache.delete(rewriteCache.keys().next().value);
      ograniczCacheRewrite(rewriteCache);
      await stateStore.saveCache('tavily_search', JSON.parse(snapshotCacheTavily(cache)));
      await stateStore.saveCache('tavily_rewrite', JSON.parse(snapshotCacheRewrite(rewriteCache)));
      cacheReady = true;
      return true;
    })().catch(error => {
      cacheReadyPromise = null;
      cacheRetryAfter = Date.now() + 60_000;
      logger.warn?.('[Tavily] Nie udało się wczytać cache z Firestore; ponowię próbę za 60 s:', error.message);
      return false;
    });
    return cacheReadyPromise;
  }
  async function zapiszLokalnySnapshot(file, content) {
    const tempFile = `${file}.tmp-${process.pid}`;
    await fs.promises.writeFile(tempFile, content, 'utf8', { mode: 0o600 });
    await fs.promises.chmod(tempFile, 0o600);
    await fs.promises.rename(tempFile, file);
  }

  // Zapis odroczony: wiele wyników w krótkim czasie = jeden zapis.
  let persistTimer = null;
  const persistCache = () => {
    if (persistTimer) return persistQueue;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const snapshot = snapshotCacheTavily(cache);
      persistQueue = persistQueue
        .catch(err => logger.warn?.('[Tavily] poprzedni zapis cache nieudany:', err.message))
        .then(async () => {
          if (stateStore?.enabled && cacheReady) {
            await stateStore.saveCache('tavily_search', JSON.parse(snapshot));
            return;
          }
          if (stateStore?.enabled && !cacheReady) {
            logger.warn?.('[Tavily] Firestore nie jest gotowy — zapisuję cache lokalnie jako kopię awaryjną.');
          }
          await zapiszLokalnySnapshot(cacheFile, snapshot);
        })
        .catch(async err => {
          logger.warn?.('[Tavily] zapis cache do Firestore nieudany; próbuję zapisu lokalnego:', err.message);
          try {
            await zapiszLokalnySnapshot(cacheFile, snapshot);
          } catch (fallbackError) {
            logger.error?.('[Tavily] Nie udało się też zapisać lokalnej kopii cache:', fallbackError.message);
          }
        });
    }, TAVILY_PERSIST_DEBOUNCE_MS);
    persistTimer.unref?.();
    return persistQueue;
  };
  const rewriteCache = new Map();
  const rewriteCacheFile = './tavily_rewrite_cache.json';
  try {
    const stat = fs.statSync(rewriteCacheFile);
    if (stat.size <= TAVILY_CACHE_MAX_BYTES) {
      const saved = JSON.parse(fs.readFileSync(rewriteCacheFile, 'utf8'));
      const entries = parseRewriteCacheEntries(saved);
      if (entries) {
        for (const [key, value] of Object.entries(entries)) {
          if (key.length <= 2048 && typeof value?.query === 'string' && value.query.length <= 2048
            && Number.isFinite(Number(value.czas)) && Date.now() - Number(value.czas) < TAVILY_REWRITE_TTL_MS) {
            rewriteCache.set(key, value);
          }
        }
      } else {
        logger.warn?.('[Tavily] rewrite cache pominięty — nieprawidłowa wersja lub rozmiar.');
      }
    } else {
      logger.warn?.(`[Tavily] rewrite cache pominięty — plik przekracza limit ${TAVILY_CACHE_MAX_BYTES} B`);
    }
  } catch (_) {}

  let rewritePersistTimer = null;
  let rewritePersistQueue = Promise.resolve();
  const persistRewriteCache = () => {
    if (rewritePersistTimer) return rewritePersistQueue;
    rewritePersistTimer = setTimeout(() => {
      rewritePersistTimer = null;
      const snapshot = snapshotCacheRewrite(rewriteCache);
      rewritePersistQueue = rewritePersistQueue
        .catch(err => logger.warn?.('[Tavily] poprzedni zapis rewrite cache nieudany:', err.message))
        .then(async () => {
          if (stateStore?.enabled && cacheReady) {
            await stateStore.saveCache('tavily_rewrite', JSON.parse(snapshot));
            return;
          }
          await zapiszLokalnySnapshot(rewriteCacheFile, snapshot);
        })
        .catch(async err => {
          logger.warn?.('[Tavily] zapis rewrite cache nieudany; próbuję kopii lokalnej:', err.message);
          try { await zapiszLokalnySnapshot(rewriteCacheFile, snapshot); }
          catch (fallbackError) { logger.error?.('[Tavily] Nie udało się zapisać lokalnego rewrite cache:', fallbackError.message); }
        });
    }, TAVILY_PERSIST_DEBOUNCE_MS);
    rewritePersistTimer.unref?.();
    return rewritePersistQueue;
  };
  const kluczRewrite = q => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const ocenaZrodla = (url, requestedDomains = []) => {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      const requested = Array.isArray(requestedDomains) && requestedDomains.some(d => {
        const clean = String(d || '').toLowerCase().replace(/^www\./, '');
        return clean && (host === clean || host.endsWith(`.${clean}`));
      });
      const official = ['minecraft.net', 'rockstargames.com', 'thewitcher.com', 'playstation.com', 'naughtydog.com', 'bandainamcoent.com', 'larian.com', 'baldursgate3.game', 'nvidia.com', 'openai.com', 'anthropic.com', 'microsoft.com', 'apple.com', 'discord.com', 'twitch.tv', 'kick.com']
        .some(d => host === d || host.endsWith(`.${d}`));
      const specialized = ['minecraft.wiki', 'gamelore.fandom.com', 'steamdb.info', 'docs.npmjs.com', 'developer.mozilla.org', 'gamefaqs.gamespot.com']
        .some(d => host === d || host.endsWith(`.${d}`));
      const guide = ['ign.com', 'gamespot.com', 'pcgamer.com', 'fandom.com']
        .some(d => host === d || host.endsWith(`.${d}`));
      if (official) return 'oficjalne';
      if (specialized || requested) return 'wyspecjalizowane';
      if (guide) return 'guide/referencyjne';
      return 'zewnętrzne-niezweryfikowane';
    } catch (_) { return 'nieznane'; }
  };
  const cacheKey = (query, domains, timeRange, sourceQuestion = '') => `${query.toLowerCase().trim()}|${(domains || []).slice().sort().join(',')}|${timeRange || ''}|${slowaKluczoweTavily(sourceQuestion).join(',')}`;

  return async function szukajTavily(pytanie, options = {}) {
    await ensureCacheReady();
    const original = String(pytanie || '').trim();
    const { domains, time_range, _skipRewrite = false, returnMeta = false, sourceStartIndex = 0, sourceQuestion = original, remainingMs = 15000, requestState = null } = options;
    try {
      let searchQuery = original;
      const rewriteKey = kluczRewrite(original);
      const rewriteZCache = (!_skipRewrite && original) ? rewriteCache.get(rewriteKey) : null;
      if (rewriteZCache && Date.now() - rewriteZCache.czas < TAVILY_REWRITE_TTL_MS) {
        searchQuery = rewriteZCache.query;
        logger.log(`[Tavily] ♻️ Rewrite z cache — bez wywołania modelu`);
      } else if (!_skipRewrite && original) {
        const canRewrite = !requestState?.zarezerwujModel || requestState.zarezerwujModel('tavily-query-rewrite');
        if (!canRewrite) {
          logger.warn?.('[Tavily] rewrite pominięty — budżet modelu/ czasu requestu wyczerpany');
        } else {
          const rewriteController = new AbortController();
          const rewriteTimeoutMs = Math.max(1, Math.min(8000, Number(remainingMs) || 8000));
          const rewriteTimer = setTimeout(() => rewriteController.abort(), rewriteTimeoutMs);
          let rewrite;
          try {
            rewrite = await groq.chat.completions.create({
              model: AI_MODELS.queryRewrite, max_tokens: 220, reasoning_effort: 'low',
              include_reasoning: false, temperature: 0, signal: rewriteController.signal,
              messages: [
                { role: 'system', content: 'Przepisz pytanie na jedno kompletne zapytanie do wyszukiwarki. Zachowaj WSZYSTKIE istotne elementy pytania, nazwy własne, relacje i części składowe. Nie odpowiadaj. Nie usuwaj drugiej ani kolejnych części pytania. Maksymalnie 35 słów. Tylko samo zapytanie.' },
                { role: 'user', content: original },
              ],
            });
          } finally {
            clearTimeout(rewriteTimer);
          }
          const rewritten = normalizeQuery(rewrite.choices?.[0]?.message?.content);
          if (rewritten && rewritten.length >= 30 && rewritten.length >= Math.min(original.length * 0.28, 80)) searchQuery = rewritten;
          else logger.log(`[Tavily] ↩️ Rewrite odrzucony — używam oryginalnego pytania: "${original}"`);
          rewriteCache.set(rewriteKey, { query: searchQuery, czas: Date.now() });
          if (rewriteCache.size > TAVILY_REWRITE_MAX_ENTRIES) rewriteCache.delete(rewriteCache.keys().next().value);
          persistRewriteCache();
        }
      }
      logger.log(`[Tavily] searchQuery: "${searchQuery}" | domains: ${JSON.stringify(domains)} | time_range: ${time_range}`);
      const key = cacheKey(searchQuery, domains, time_range, sourceQuestion);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.czas < (cached.ttl || TAVILY_CACHE_TTL_MS)) {
        onStatus({ status: 'cache', query: searchQuery });
        const cachedText = przesunSourceIdsTavily(cached.wynik, sourceStartIndex);
        return returnMeta ? { status: 'ok', text: cachedText, cached: true } : cachedText;
      }
      const active = inFlight.get(key);
      if (active) {
        onStatus({ status: 'deduped', query: searchQuery });
        return active;
      }

      const promise = (async () => {
        const validTimeRange = time_range?.replace('past_', '') || null;
        const historical = !validTimeRange;
        const request = {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey, query: searchQuery,
            search_depth: historical ? 'advanced' : 'basic',
            max_results: historical ? 10 : 7,
            chunks_per_source: 3, include_answer: false,
            include_raw_content: false,
            ...(domains && { include_domains: domains }),
            ...(validTimeRange && { time_range: validTimeRange }),
          }),
        };
        let res;
        for (let probe = 0; probe < 2; probe++) {
          res = await fetchZTimeout('https://api.tavily.com/search', request);
          // 429 = przekroczony limit: ponowienie po 250 ms nic nie da, ponawiamy tylko błędy 5xx.
          if (res.ok || ![500, 502, 503, 504].includes(res.status) || probe === 1) break;
          await new Promise(resolve => setTimeout(resolve, 250 * (probe + 1)));
        }
        if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const all = Array.isArray(data.results) ? data.results : [];
        const rejected = [];
        const poDomenach = all.filter(r => {
          if (!r?.url || czyZablokowanyHostTavily(r.url) || (domains?.length && !hostnamePasujeDoDomenyTavily(r.url, domains))) {
            rejected.push(r); return false;
          }
          return true;
        });
        if (rejected.length) logger.log(`[Tavily] 🛡️ Odrzucono ${rejected.length} wyników przez lokalny filtr domen/URL`);
        const scoreFilter = filtrujPoScore(poDomenach);
        const resultsPoScore = scoreFilter.kept;
        const results = rerankujWynikiTavily(resultsPoScore, sourceQuestion, domains, { freshness: time_range === 'day' || time_range === 'week' ? 'live' : 'evergreen' });
        const odrzuconePoScore = scoreFilter.dropped;
        if (odrzuconePoScore) logger.log(`[Tavily] 📉 Odrzucono ${odrzuconePoScore} wyników o niskim score (< ${TAVILY_MIN_SCORE})`);
        if (scoreFilter.lowConfidence) logger.log('[Tavily] ⚠️ Wszystkie wyniki poniżej progu jakości — brak materiału dowodowego');
        if (czyWymagaSecondaryRetrieval(results, sourceQuestion, time_range)) {
          const secondaryTimeoutMs = Math.max(1000, Math.min(15000, Number(remainingMs) || 15000));
          const secondary = await searchSecondaryProviders({
            query: sourceQuestion || searchQuery,
            geminiKey,
            exaKey,
            fetchFn: fetchZTimeout,
            startIndex: sourceStartIndex,
            domains,
            prefer: time_range ? 'gemini' : 'exa',
            timeoutMs: secondaryTimeoutMs,
          });
          if (secondary.status === 'ok' && secondary.text) {
            const secondaryProviders = [...new Set((secondary.sources || []).map(s => s.provider).filter(Boolean))];
            logger.log(`[Retrieval] 🔎 Tavily weak — dołączono secondary providerów: ${secondaryProviders.join(', ') || 'unknown'} (źródeł: ${secondary.sources?.length || 0})`);
            onStatus({ status: 'secondary', query: searchQuery, providers: secondaryProviders, sourceCount: secondary.sources?.length || 0 });
            // Secondary retrieval uzupełnia Tavily zamiast go zastępować. Wcześniej
            // słaby Tavily był całkowicie wyrzucany, przez co traciliśmy użyteczne
            // fragmenty i validator miał mniej dowodów.
            const secondaryText = secondary.text;
            const secondaryRebased = secondary.sources?.length
              ? formatSources(
                  secondary.sources.map((source, index) => ({
                    ...source,
                    sourceId: `SOURCE ${sourceStartIndex + results.length + index + 1}`,
                  })),
                  sourceStartIndex + results.length,
                )
              : secondaryText;
            const primaryPreview = results.slice(0, 4).map((r, index) => {
              const content = String(r.content || r.raw_content || '').trim();
              const materialRaw = content.substring(0, 1800)
                .split('\n').map(line => line.trim()).filter(Boolean).join('\n');
              const material = sanityzujTrescZrodlaTavily(filtrujMaterialPoSlowachTavily(materialRaw, sourceQuestion));
              const host = (() => { try { return new URL(r.url).hostname; } catch (_) { return '(nieznany host)'; } })();
              return [
                `[SOURCE ${sourceStartIndex + index + 1}]`,
                'TYP: UNTRUSTED_WEB_DATA',
                `TYTUŁ: ${sanityzujTrescZrodlaTavily(String(r.title || '(brak tytułu)').slice(0, 300))}`,
                `HOST: ${host}`,
                `URL: ${r.url}`,
                `TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\n${material}\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>`,
              ].join('\n');
            }).join('\n---\n');
            const mergedText = [primaryPreview, secondaryRebased].filter(Boolean).join('\n---\n');
            return returnMeta ? { status: 'ok', text: mergedText, secondary: true, sources: [...results, ...(secondary.sources || [])] } : mergedText;
          }
        }
        if (!results.length) { onStatus({ status: 'empty', query: searchQuery }); return returnMeta ? { status: 'empty', text: '' } : ''; }
        const limit = historical ? 6000 : 5000;
        const sourceConflicts = wykryjKonfliktyZrodelTavily(results, sourceQuestion, domains);
        const sourceConflictReport = zbudujRaportKonfliktowTavily(sourceConflicts);
        const sourceBlocks = results.slice(0, 4).map((r, index) => {
          const content = String(r.content || '').trim();
          const raw = String(r.raw_content || '').trim();
          // content = fragmenty dobrane pod zapytanie; raw tylko awaryjnie.
          // Lekki filtr usuwa zdania niezwiązane z pytaniem, ale nigdy nie usuwa całego źródła.
          const materialRaw = (content || raw).substring(0, 2200)
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .join('\n');
          const material = sanityzujTrescZrodlaTavily(filtrujMaterialPoSlowachTavily(materialRaw, sourceQuestion));
          const host = (() => { try { return new URL(r.url).hostname; } catch (_) { return '(nieznany host)'; } })();
          const quality = ocenaZrodla(r.url, domains);
          return `[SOURCE ${sourceStartIndex + index + 1}]\nTYP: UNTRUSTED_WEB_DATA\nTYTUŁ: ${sanityzujTrescZrodlaTavily(String(r.title || '(brak tytułu)').slice(0, 300))}\nHOST: ${host}\nURL: ${r.url}\nHEURYSTYCZNA_OCENA: ${quality}\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\n${material}\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>`;
        });
        const blocks = [];
        let used = 0;
        for (const block of sourceBlocks) {
          const extra = blocks.length ? 5 : 0;
          if (used + extra + block.length > limit) break;
          blocks.push(block);
          used += extra + block.length;
        }
        const text = [sourceConflictReport, blocks.join('\n---\n')].filter(Boolean).join('\n---\n');
        logger.log(`[Tavily] ✅ Zwrócono ${results.length}/${all.length} wyników źródłowych (${text.length} znaków)`);
        cache.set(key, { wynik: text, czas: Date.now(), ttl: ttlDlaZakresu(validTimeRange) });
        ograniczCacheTavily(cache);
        persistCache();
        onStatus({ status: 'ok', query: searchQuery, results: results.length });
        return returnMeta ? { status: 'ok', text } : text;
      })();
      inFlight.set(key, promise);
      try { return await promise; }
      finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
    } catch (err) {
      logger.error('[Tavily] Błąd:', err.message);
      const rateLimited = /(?:\b429\b|rate.?limit|too many requests|quota)/i.test(err.message || '');
      const status = rateLimited ? 'rate_limited' : (/timeout|abort|timed out/i.test(err.message || '') ? 'timeout' : 'error');
      const secondary = await searchSecondaryProviders({
        query: sourceQuestion || original,
        geminiKey,
        exaKey,
        fetchFn: fetchZTimeout,
        startIndex: sourceStartIndex,
        domains,
        prefer: 'gemini',
        timeoutMs: Math.max(1, Math.min(15000, Number(remainingMs) || 15000)),
      });
      if (secondary.status === 'ok' && secondary.text) {
        const secondaryProviders = [...new Set((secondary.sources || []).map(s => s.provider).filter(Boolean))];
        onStatus({ status: 'secondary', query: original, providers: secondaryProviders, sourceCount: secondary.sources?.length || 0, fallbackFrom: status });
        return returnMeta ? { status: 'ok', text: secondary.text, secondary: true, sources: secondary.sources } : secondary.text;
      }
      onStatus({ status, query: original, error: err.message });
      return returnMeta ? { status, text: '', error: err.message } : null;
    }  };
}

module.exports = {
  createTavilySearch,
  hostnamePasujeDoDomenyTavily,
  czyZablokowanyHostTavily,
  ttlDlaZakresu,
  ograniczCacheTavily,
  przesunSourceIdsTavily,
  snapshotCacheTavily,
  filtrujPoScore,
  rerankujWynikiTavily,
  sygnalyClaimuTavily,
  claimCoverageTavily,
  wykryjKonfliktyZrodelTavily,
  zbudujRaportKonfliktowTavily,
  sanityzujTrescZrodlaTavily,
  czyWymagaSecondaryRetrieval,
};
