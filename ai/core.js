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
    'ubisoft.com','bethesda.net','starwars.com','openai.com','discord.com'
  ];
  const specialized = [
    'gamelore.fandom.com','minecraft.wiki','gamefaqs.gamespot.com',
    'steamdb.info','howlongtobeat.com','pcgamingwiki.com'
  ];
  const reference = ['wikipedia.org','imdb.com','mobygames.com'];
  const guide = ['ign.com','gamespot.com','pcgamer.com','eurogamer.net','fandom.com'];

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

function normalizeSource(source = {}, index = 0) {
  // Gemini grounding snippets are model-output spans tied to a URL, not page text.
  // webRetrieval deliberately marks them with content: ''; preserve that sentinel
  // instead of promoting the snippet into evidence during core normalization.
  const metadataOnlyGemini = /^gemini/i.test(String(source.provider || '')) && source.content === '';
  const content = String(metadataOnlyGemini ? '' : (source.content || source.raw_content || source.snippet || '')).replace(/\s+/g, ' ').trim();
  const title = String(source.title || '').replace(/\s+/g, ' ').trim();
  return {
    ...source,
    sourceId: source.sourceId || `SOURCE ${index + 1}`,
    url: String(source.url || '').trim(),
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
      const ageDays = Math.max(0, (Date.now() - new Date(date).getTime()) / 86400000);
      if (Number.isFinite(ageDays)) freshnessBonus = ageDays <= 7 ? 0.12 : ageDays <= 30 ? 0.06 : ageDays <= 90 ? 0 : -0.08;
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
  const base = [];
  const add = (x, reason = 'primary') => {
    const v = String(x || '').replace(/\s+/g, ' ').trim();
    if (v.length < 8) return;
    const key = normalize(v);
    if (!base.some(x => normalize(x.query) === key)) base.push({ query:v, reason });
  };

  add(q);
  if (entity) add(`${entity} ${q}`);
  if (game && game !== entity) add(`${game} ${q}`);

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
  const strong = selected.filter(x => x.coreScore >= 0.55);
  const relevant = selected.filter(x => x.relevance >= 0.35 || x.titleRelevance >= 0.45);

  // Niezależne potwierdzenie musi pochodzić ze źródeł trafnych. Wcześniej nietrafne źródło
  // z drugiej domeny wystarczało, żeby „weak” zamienić w „usable”/„strong”.
  // „Źródła” z Gemini grounding to wycinki odpowiedzi modelu z przypisanym URL-em, a nie tekst
  // strony. Mogą być trafne, ale nie są niezależnym potwierdzeniem.
  const independent = x => !czyStreszczenieModelu(x);
  const strongIndependent = strong.filter(independent);
  const evidenceHosts = new Set([...strongIndependent, ...relevant.filter(independent)].map(x => x.host).filter(Boolean));

  let status = 'weak';
  if (strongIndependent.length >= 2 && evidenceHosts.size >= 2 && relevant.length >= 2) status = 'strong';
  else if (strongIndependent.length >= 1 && relevant.length >= 1 && evidenceHosts.size >= 2) status = 'usable';

  return {
    status,
    sources: selected,
    sourceCount: selected.length,
    independentHosts: hosts.size,
    relevantHosts: evidenceHosts.size,
    modelSummarySources: selected.filter(czyStreszczenieModelu).length,
    strongSources: strong.length,
    relevantSources: relevant.length,
    coverageScore: Number(Math.min(1,
      relevant.length / (routing.is_lore || routing.is_gameplay ? 3 : 2)
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
  decideEvidencePolicy,
};
