'use strict';

const { AI_MODELS } = require('./modelConfig');
const { isIP, BlockList } = require('node:net');
const { lookup: lookupDns } = require('node:dns/promises');
const { sanitizeUntrustedText } = require('./untrustedText');
const { awaitWithAbortTimeout } = require('./provider-runtime');

function cleanText(value, max = 5000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeSource({ provider, title, url, snippet, content, publishedAt = null, score = null }, index = 0) {
  return {
    sourceId: `SOURCE ${index + 1}`,
    provider,
    title: sanitizeUntrustedText(cleanText(title || '(brak tytułu)', 300)),
    url: String(url || '').trim(),
    snippet: sanitizeUntrustedText(cleanText(snippet || content, 700)),
    // An explicit empty string means we have URL metadata but no page text.
    // Do not promote a model-generated grounding segment to source evidence.
    content: sanitizeUntrustedText(cleanText(content === '' ? '' : (content || snippet), 4000)),
    publishedAt: publishedAt || null,
    score: typeof score === 'number' ? score : null,
  };
}

function formatSources(sources, startIndex = 0) {
  return sources.filter(s => s?.url && s?.content).map((s, i) => {
    const id = `SOURCE ${startIndex + i + 1}`;
    return [
      `[${id}]`,
      'TYP: UNTRUSTED_WEB_DATA',
      `TYTUŁ: ${s.title}`,
      `HOST: ${safeHost(s.url)}`,
      `URL: ${cleanText(s.url, 500).replace(/[\r\n]/g, '')}`,
      `PROVIDER: ${cleanText(s.provider, 80).replace(/[^a-z0-9_-]/gi, '')}`,
      'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
      s.content,
      '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
    ].join('\n');
  }).join('\n---\n');
}

function normalizeTimeoutMs(value, fallback, max) {
  const parsed = Number(value);
  const timeout = Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  return Math.max(1, Math.min(max, timeout));
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch (_) { return '(nieznany host)'; }
}

const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;

async function odczytajOgraniczonyTekst(response, maxBytes = MAX_PROVIDER_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch (_) {}
    throw new Error('provider_response_too_large');
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength || 0;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('provider_response_too_large');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }

  if (typeof response.text === 'function') {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('provider_response_too_large');
    return body;
  }
  if (typeof response.json === 'function') {
    const data = await response.json().catch(() => ({}));
    const body = JSON.stringify(data);
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('provider_response_too_large');
    return body;
  }
  return '';
}

async function odczytajOgraniczonyJson(response, maxBytes = MAX_PROVIDER_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch (_) {}
    throw new Error('provider_response_too_large');
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength || 0;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('provider_response_too_large');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
    }
    try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
    catch (error) { const invalid = new Error('provider_invalid_json'); invalid.cause = error; throw invalid; }
  }

  // Własne transporty mogą udostępniać json() i text() niezależnie.
  // Preferuj json(), tak jak robił poprzedni kontrakt fetchJson; limit sprawdzamy
  // po serializacji. Produkcyjny fetch używa wyżej ograniczonego streamu.
  if (typeof response.json === 'function') {
    let data;
    try { data = await response.json(); }
    catch (error) { const invalid = new Error('provider_invalid_json'); invalid.cause = error; throw invalid; }
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > maxBytes) throw new Error('provider_response_too_large');
    return data;
  }
  if (typeof response.text === 'function') {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('provider_response_too_large');
    try { return JSON.parse(body); }
    catch (error) { const invalid = new Error('provider_invalid_json'); invalid.cause = error; throw invalid; }
  }
  return {};
}

async function fetchJson(fetchFn, url, options, timeoutMs = 30000) {
  const boundedTimeoutMs = normalizeTimeoutMs(timeoutMs, 30000, 30000);
  const controller = new AbortController();
  const request = (async () => {
    // Stałe endpointy providerów nie powinny przekierowywać żądań na inne hosty.
    const response = await fetchFn(url, { ...options, redirect: 'error', signal: controller.signal }, boundedTimeoutMs);
    const data = await odczytajOgraniczonyJson(response);
    if (!response.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
    return data;
  })();
  return awaitWithAbortTimeout(request, boundedTimeoutMs, controller, 'web retrieval');
}

async function searchGeminiWeb({ apiKey, query, fetchFn = fetch, startIndex = 0, timeoutMs = 30000 }) {
  if (!apiKey || !query) return { status: 'disabled', text: '', sources: [] };
  try {
    const data = await fetchJson(fetchFn,
      `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.webSearch}:generateContent`,
      {
        method: 'POST',
        // Klucz w nagłówku, nie w URL: adres trafia do logów błędów, proxy i raportów.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: String(query).slice(0, 1200) }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 900 },
        }),
      },
      normalizeTimeoutMs(timeoutMs, 30000, 30000)
    );
    const candidate = data?.candidates?.[0];
    const parts = (candidate?.content?.parts || []).map(p => String(p?.text || ''));
    const text = parts.join(' ').trim();
    const gm = candidate?.groundingMetadata || data?.groundingMetadata || {};
    const chunks = Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
    const supports = Array.isArray(gm.groundingSupports) ? gm.groundingSupports : [];
    const sources = chunks.map((chunk, i) => {
      const web = chunk?.web || {};
      const citedSegments = supports
        .filter(s => Array.isArray(s?.groundingChunkIndices) && s.groundingChunkIndices.includes(i))
        .map(s => {
          const segment = s?.segment || {};
          // groundingSupports.segment.text is the model-output span, not text
          // fetched from the cited webpage. Use it only as metadata/snippet.
          if (typeof segment.text === 'string' && segment.text.trim()) return segment.text;
          // The API offsets are UTF-8 byte offsets within segment.partIndex, not
          // JavaScript UTF-16 offsets into the concatenated response string.
          const partIndex = Number.isInteger(segment.partIndex) ? segment.partIndex : 0;
          const partText = parts[partIndex] || '';
          const start = Number.isInteger(segment.startIndex) ? segment.startIndex : null;
          const end = Number.isInteger(segment.endIndex) ? segment.endIndex : null;
          if (start === null || end === null || start < 0 || end < start) return '';
          return Buffer.from(partText, 'utf8').subarray(start, end).toString('utf8');
        })
        .filter(Boolean);
      return normalizeSource({
        provider: 'gemini_google_search',
        title: web.title,
        url: web.uri || web.url,
        snippet: citedSegments.join(' '),
        content: '',
        score: null,
      }, i);
    }).filter(s => s.url && s.snippet);
    return {
      status: sources.length ? 'grounded_metadata' : (text ? 'text_only' : 'empty'),
      // Text-only grounding is deliberately not exposed as source evidence.
      answer: text,
      text: formatSources(sources, startIndex),
      sources,
      citations: supports,
      groundingQueries: gm.webSearchQueries || [],
    };
  } catch (error) {
    return { status: 'error', text: '', sources: [], error: error.message };
  }
}

async function searchExa({ apiKey, query, fetchFn = fetch, startIndex = 0, domains = [], timeoutMs = 30000 }) {
  if (!apiKey || !query) return { status: 'disabled', text: '', sources: [] };
  try {
    const data = await fetchJson(fetchFn, 'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          query: String(query).slice(0, 1200),
          type: 'auto',
          numResults: 6,
          contents: { text: { maxCharacters: 3000 }, highlights: { maxCharacters: 1000 } },
          ...(domains?.length ? { includeDomains: domains } : {}),
        }),
      },
      normalizeTimeoutMs(timeoutMs, 30000, 30000)
    );
    const results = Array.isArray(data?.results) ? data.results : [];
    const sources = results.map((r, i) => normalizeSource({
      provider: 'exa',
      title: r.title,
      url: r.url,
      snippet: r.highlights?.join(' '),
      // Highlights are search snippets, not page evidence. Only extracted page text
      // may enter the claim validator as source content.
      content: r.text || '',
      publishedAt: r.publishedDate,
      score: r.score,
    }, i)).filter(s => s.url && s.content);
    return { status: sources.length ? 'ok' : 'empty', text: formatSources(sources, startIndex), sources };
  } catch (error) {
    return { status: 'error', text: '', sources: [], error: error.message };
  }
}

// Opcjonalnie (AI_GEMINI_EXTRACT=1): Gemini służy tylko do znalezienia stron, a ich treść pobiera
// Tavily Extract. Dzięki temu walidator porównuje cytat z prawdziwym tekstem strony, a nie z
// parafrazą modelu. Odpowiedź API czytamy defensywnie (kształt nieweryfikowany na żywym API).
const BLOKOWANE_ADRESY = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOKOWANE_ADRESY.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 23], ['2001:20::', 28], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOKOWANE_ADRESY.addSubnet(address, prefix, 'ipv6');
const GLOBALNY_ZAKRES_IPV6 = new BlockList();
GLOBALNY_ZAKRES_IPV6.addSubnet('2000::', 3, 'ipv6');

function ipv4ZAdresuMapowanegoIPv6(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (!value.startsWith('::ffff:')) return null;
  const tail = value.slice(7);
  if (isIP(tail) === 4) return tail;
  const parts = tail.split(':');
  if (parts.length !== 2 || parts.some(part => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function czyPublicznyAdresIP(address) {
  const normalized = String(address || '').split('%')[0];
  const family = isIP(normalized);
  if (family === 4) return !BLOKOWANE_ADRESY.check(normalized, 'ipv4');
  if (family === 6) {
    const mapped = ipv4ZAdresuMapowanegoIPv6(normalized);
    if (mapped) return !BLOKOWANE_ADRESY.check(mapped, 'ipv4');
    return GLOBALNY_ZAKRES_IPV6.check(normalized, 'ipv6') && !BLOKOWANE_ADRESY.check(normalized, 'ipv6');
  }
  return false;
}

async function czyHostMaPubliczneDNS(host, lookupFn = lookupDns, timeoutMs = 1500) {
  let timer;
  try {
    const records = await Promise.race([
      Promise.resolve().then(() => lookupFn(host, { all: true, verbatim: true })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns_lookup_timeout')), timeoutMs);
        timer.unref?.();
      }),
    ]);
    const addresses = Array.isArray(records) ? records : (records ? [records] : []);
    return addresses.length > 0 && addresses.every(record => czyPublicznyAdresIP(record?.address));
  } catch (_) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function czyBezpiecznyPublicznyUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch (_) {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  if (parsed.port && !((parsed.protocol === 'http:' && parsed.port === '80')
    || (parsed.protocol === 'https:' && parsed.port === '443'))) return false;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || isIP(host) !== 0 || !host.includes('.')) return false;
  if ([...parsed.searchParams.keys()].some(key => /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|password|passwd|authorization|auth|session|signature|sig|code)$/i.test(key))) return false;
  if (/(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|test|invalid|example|onion)$/i.test(host)) return false;
  return true;
}

async function extractTavilyPages({ apiKey, urls, fetchFn = fetch, lookupFn = lookupDns, timeoutMs = 12000 }) {
  // Sprawdź składnię URL i wszystkie odpowiedzi DNS. W razie błędu lookup
  // lub choć jednego adresu prywatnego odrzuć cały URL (fail closed).
  // To jest preflight przed przekazaniem URL do Tavily, a nie pinning połączenia:
  // DNS i pobranie strony wykonuje infrastruktura Tavily, więc nie chroni nas
  // przed DNS rebindingiem po stronie providera. Nie traktuj tego jako pełnej
  // ochrony SSRF; provider musi egzekwować własne blokady adresów i redirectów.
  const inputUrls = Array.isArray(urls) ? urls.slice(0, 30) : [];
  const candidates = [...new Set(inputUrls.filter(czyBezpiecznyPublicznyUrl).map(u => String(u).trim()))].slice(0, 3);
  if (!apiKey || !candidates.length) return new Map();
  const checked = await Promise.all(candidates.map(async url => {
    const host = new URL(url).hostname;
    return await czyHostMaPubliczneDNS(host, lookupFn) ? url : null;
  }));
  const wanted = checked.filter(Boolean);
  if (!wanted.length) return new Map();
  try {
    const data = await fetchJson(fetchFn, 'https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ urls: wanted, extract_depth: 'basic' }),
    }, normalizeTimeoutMs(timeoutMs, 12000, 20000));
    const out = new Map();
    for (const item of Array.isArray(data?.results) ? data.results : []) {
      const url = String(item?.url || '').trim();
      const text = String(item?.raw_content || item?.content || '').trim();
      if (url && text.length >= 80) out.set(url, text.slice(0, 12000));
    }
    return out;
  } catch (_) {
    return new Map();
  }
}

async function zastapStreszczeniaTrescia(result, { tavilyKey, fetchFn, lookupFn = lookupDns, timeoutMs, startIndex }) {
  if (process.env.AI_GEMINI_EXTRACT !== '1' || !tavilyKey || !result?.sources?.length) return result;
  const pages = await extractTavilyPages({ apiKey: tavilyKey, urls: result.sources.map(x => x.url), fetchFn, lookupFn, timeoutMs });
  if (!pages.size) return result;
  const sources = result.sources.map((source, i) => {
    const page = pages.get(source.url);
    // Po podmianie to tekst strony, więc provider przestaje być „gemini*” i źródło liczy się normalnie.
    return page ? normalizeSource({ provider: 'tavily_extract', title: source.title, url: source.url, content: page, score: null }, i) : source;
  });
  const hasPageText = sources.some(source => source?.url && String(source.content || '').trim());
  return { ...result, status: hasPageText ? 'ok' : result.status, sources, text: formatSources(sources, startIndex) };
}

async function searchSecondaryProviders({ query, geminiKey, exaKey, tavilyKey = null, fetchFn = fetch, lookupFn = lookupDns, startIndex = 0, domains = [], prefer = 'gemini', timeoutMs = 15000 }) {
  const budgetMs = Number.isFinite(Number(timeoutMs)) ? Math.max(0, Number(timeoutMs)) : 15000;
  const startedAt = Date.now();
  const remainingTimeoutMs = () => Math.max(0, budgetMs - (Date.now() - startedAt));
  const order = prefer === 'exa'
    ? [['exa', exaKey], ['gemini', geminiKey]]
    : [['gemini', geminiKey], ['exa', exaKey]];
  const errors = [];
  for (const [provider, key] of order) {
    if (!key) continue;
    const providerTimeoutMs = remainingTimeoutMs();
    if (providerTimeoutMs <= 0) break;
    const result = provider === 'exa'
      ? await searchExa({ apiKey: key, query, fetchFn, startIndex, domains, timeoutMs: providerTimeoutMs })
      : await searchGeminiWeb({ apiKey: key, query, fetchFn, startIndex, timeoutMs: providerTimeoutMs });
    if (provider === 'gemini' && result.sources.length) {
      const extractTimeoutMs = remainingTimeoutMs();
      const extracted = extractTimeoutMs > 0
        ? await zastapStreszczeniaTrescia(result, { tavilyKey, fetchFn, lookupFn, timeoutMs: extractTimeoutMs, startIndex })
        : result;
      if (extracted.status === 'ok' && extracted.sources.some(source => source?.url && String(source.content || '').trim())) return extracted;
      errors.push('gemini: grounding returned URL metadata but no extracted page text');
      continue;
    }
    if (result.status === 'ok' && result.sources.length && result.sources.some(source => source?.url && String(source.content || '').trim())) {
      return result;
    }
    if (result.error) errors.push(`${provider}: ${result.error}`);
  }
  return { status: 'empty', text: '', sources: [], error: errors.join('; ') };
}

module.exports = { normalizeSource, formatSources, searchGeminiWeb, searchExa, searchSecondaryProviders, extractTavilyPages, odczytajOgraniczonyJson, odczytajOgraniczonyTekst, czyBezpiecznyPublicznyUrl, czyPublicznyAdresIP, czyHostMaPubliczneDNS };
