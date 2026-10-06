'use strict';

const fs = require('fs');
const { searchSecondaryProviders } = require('./webRetrieval');

const TAVILY_CACHE_TTL_MS = 10 * 60 * 1000; // domyślne / pytania o świeże wiadomości
const TAVILY_REWRITE_TTL_MS = 6 * 60 * 60 * 1000;
const TAVILY_PERSIST_DEBOUNCE_MS = 5000;
const TAVILY_MIN_SCORE = Number(process.env.TAVILY_MIN_SCORE) || 0.2;
const TAVILY_MIN_STRONG_RESULTS = 1;

// TTL zależny od tego, jak szybko odpowiedź się starzeje: świeże wiadomości krótko,
// fakty historyczne (bez time_range) długo.
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
  let text = String(material || '');
  text = text
    .replace(/<\/?(?:system|developer|assistant|user|tool|instructions?|prompt|context)\b[^>]*>/gi, '[USUNIĘTY_MARKER_ZRODŁA]')
    .replace(/\[\s*(?:system|developer|assistant|user|tool|instructions?|prompt)\s*\]/gi, '[USUNIĘTY_MARKER_ZRODŁA]')
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|messages?)\b/gi, '[USUNIĘTA_INSTRUKCJA_ZRODŁA]')
    .replace(/\b(?:system|developer)\s+(?:message|prompt)\s*:/gi, '[USUNIĘTY_MARKER_ZRODŁA:]')
    .replace(/\b(?:you are|act as|jesteś|działaj jako)\s+(?:an?\s+)?(?:assistant|system|developer|model|ai|bot)\b/gi, '[USUNIĘTA_INSTRUKCJA_ROLI]');
  return text.replace(/\s{2,}/g, ' ').trim();
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

  const keep = relevant.slice(0, 8).sort((a, b) => a.index - b.index).map(x => x.sentence);
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
function rerankujWynikiTavily(results, sourceQuestion, requestedDomains = [], options = {}) {
  const keywords = slowaKluczoweTavily(sourceQuestion);
  return [...(Array.isArray(results) ? results : [])].map((result, index) => {
    const quality = ocenaZrodlaLokalnie(result?.url, requestedDomains);
    const qualityBonus = quality === 'oficjalne' ? 0.12 : quality === 'wyspecjalizowane' ? 0.12 : quality === 'guide/referencyjne' ? 0.02 : 0;
    const haystack = normalizujTokenTavily([result?.title, result?.content].filter(Boolean).join(' '));
    const coverage = keywords.length ? keywords.filter(k => haystack.includes(k)).length / keywords.length : 0;
    const coverageBonus = Math.min(0.15, coverage * 0.15);
    const baseScore = typeof result?.score === 'number' ? result.score : 0;
    const published = dataZrodlaTavily(result);
    const freshnessBonus = options.freshness === 'live' && published ? (published >= Date.now() - 7 * 86400000 ? 0.08 : 0) : 0;
    return { result, index, rerankScore: baseScore + qualityBonus + coverageBonus + freshnessBonus };
  }).sort((a, b) => b.rerankScore - a.rerankScore || a.index - b.index).map(x => x.result);
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

function czyZablokowanyHostTavily(url) {
  try { return TAVILY_BLOKOWANE_HOSTY.has(new URL(url).hostname.toLowerCase().replace(/^www\./, '')); }
  catch (_) { return true; }
}

function createTavilySearch({ apiKey, groq, fetchZTimeout, normalizeQuery, logger = console, onStatus = () => {}, cacheFile = './tavily_cache.json', geminiKey = process.env.GEMINI_API_KEY, exaKey = process.env.EXA_API_KEY }) {
  const cache = new Map();
  const inFlight = new Map();
  let persistQueue = Promise.resolve();
  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    for (const [key, value] of Object.entries(saved || {})) {
      if (value?.czas && Date.now() - value.czas < (value.ttl || TAVILY_CACHE_TTL_MS)) cache.set(key, value);
    }
  } catch (_) {}
  // Zapis odroczony: wiele wyników w krótkim czasie = jeden zapis pliku (snapshot z chwili zapisu).
  let persistTimer = null;
  const persistCache = () => {
    if (persistTimer) return persistQueue;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const snapshot = JSON.stringify(Object.fromEntries(cache));
      persistQueue = persistQueue
        .catch(err => logger.warn?.('[Tavily] poprzedni zapis cache nieudany:', err.message))
        .then(() => fs.promises.writeFile(cacheFile, snapshot, 'utf8'))
        .catch(err => logger.warn?.('[Tavily] zapis cache nieudany:', err.message));
    }, TAVILY_PERSIST_DEBOUNCE_MS);
    persistTimer.unref?.();
    return persistQueue;
  };
  const rewriteCache = new Map();
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
    const original = String(pytanie || '').trim();
    const { domains, time_range, _skipRewrite = false, returnMeta = false, sourceStartIndex = 0, sourceQuestion = original } = options;
    try {
      let searchQuery = original;
      const rewriteKey = kluczRewrite(original);
      const rewriteZCache = (!_skipRewrite && original) ? rewriteCache.get(rewriteKey) : null;
      if (rewriteZCache && Date.now() - rewriteZCache.czas < TAVILY_REWRITE_TTL_MS) {
        searchQuery = rewriteZCache.query;
        logger.log(`[Tavily] ♻️ Rewrite z cache — bez wywołania modelu`);
      } else if (!_skipRewrite && original) {
        const rewrite = await groq.chat.completions.create({
          model: 'openai/gpt-oss-20b', max_tokens: 220, reasoning_effort: 'low',
          include_reasoning: false, temperature: 0,
          messages: [
            { role: 'system', content: 'Przepisz pytanie na jedno kompletne zapytanie do wyszukiwarki. Zachowaj WSZYSTKIE istotne elementy pytania, nazwy własne, relacje i części składowe. Nie odpowiadaj. Nie usuwaj drugiej ani kolejnych części pytania. Maksymalnie 35 słów. Tylko samo zapytanie.' },
            { role: 'user', content: original },
          ],
        });
        const rewritten = normalizeQuery(rewrite.choices?.[0]?.message?.content);
        if (rewritten && rewritten.length >= 30 && rewritten.length >= Math.min(original.length * 0.28, 80)) searchQuery = rewritten;
        else logger.log(`[Tavily] ↩️ Rewrite odrzucony — używam oryginalnego pytania: "${original}"`);
        rewriteCache.set(rewriteKey, { query: searchQuery, czas: Date.now() });
        if (rewriteCache.size > 500) rewriteCache.delete(rewriteCache.keys().next().value);
      }
      logger.log(`[Tavily] searchQuery: "${searchQuery}" | domains: ${JSON.stringify(domains)} | time_range: ${time_range}`);
      const key = cacheKey(searchQuery, domains, time_range, sourceQuestion);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.czas < (cached.ttl || TAVILY_CACHE_TTL_MS)) {
        onStatus({ status: 'cache', query: searchQuery });
        return returnMeta ? { status: 'ok', text: cached.wynik, cached: true } : cached.wynik;
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
        if (results.length < 2) {
          const secondary = await searchSecondaryProviders({
            query: sourceQuestion || searchQuery,
            geminiKey,
            exaKey,
            fetchFn: fetchZTimeout,
            startIndex: sourceStartIndex,
            domains,
            prefer: time_range ? 'gemini' : 'exa',
          });
          if (secondary.status === 'ok' && secondary.text) {
            logger.log(`[Retrieval] 🔎 Tavily weak — użyto secondary provider (${secondary.sources.map(s => s.provider).join(', ')})`);
            onStatus({ status: 'secondary', query: searchQuery, providers: secondary.sources.map(s => s.provider) });
            return returnMeta ? { status: 'ok', text: secondary.text, secondary: true, sources: secondary.sources } : secondary.text;
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
          const materialRaw = (content || raw).substring(0, 1400)
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
        if (cache.size > 300) cache.delete(cache.keys().next().value);
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
      onStatus({ status, query: original, error: err.message });
      return returnMeta ? { status, text: '', error: err.message } : null;
    }
  };
}

module.exports = {
  createTavilySearch,
  hostnamePasujeDoDomenyTavily,
  czyZablokowanyHostTavily,
  ttlDlaZakresu,
  filtrujPoScore,
  rerankujWynikiTavily,
  wykryjKonfliktyZrodelTavily,
  zbudujRaportKonfliktowTavily,
  sanityzujTrescZrodlaTavily,
};