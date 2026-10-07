'use strict';

const { AI_MODELS } = require('./modelConfig');
const { sanitizeUntrustedText } = require('./untrustedText');

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
    content: sanitizeUntrustedText(cleanText(content || snippet, 4000)),
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

function safeHost(url) {
  try { return new URL(url).hostname; } catch (_) { return '(nieznany host)'; }
}

async function fetchJson(fetchFn, url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function searchGeminiWeb({ apiKey, query, fetchFn = fetch, startIndex = 0, timeoutMs = 30000 }) {
  if (!apiKey || !query) return { status: 'disabled', text: '', sources: [] };
  try {
    const data = await fetchJson(fetchFn,
      `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.webSearch}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: String(query).slice(0, 1200) }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0, maxOutputTokens: 900 },
        }),
      },
      Math.max(1000, Math.min(30000, Number(timeoutMs) || 30000))
    );
    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts || []).map(p => p?.text || '').join(' ').trim();
    const gm = candidate?.groundingMetadata || data?.groundingMetadata || {};
    const chunks = Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
    const supports = Array.isArray(gm.groundingSupports) ? gm.groundingSupports : [];
    const sources = chunks.map((chunk, i) => {
      const web = chunk?.web || {};
      const citedSegments = supports
        .filter(s => Array.isArray(s?.groundingChunkIndices) && s.groundingChunkIndices.includes(i))
        .map(s => {
          const segment = s?.segment || {};
          const start = Number.isInteger(segment.startIndex) ? segment.startIndex : null;
          const end = Number.isInteger(segment.endIndex) ? segment.endIndex : null;
          return start !== null && end !== null ? text.slice(start, end) : '';
        })
        .filter(Boolean);
      return normalizeSource({
        provider: 'gemini_google_search',
        title: web.title,
        url: web.uri || web.url,
        snippet: citedSegments.join(' '),
        content: citedSegments.join(' '),
        score: null,
      }, i);
    }).filter(s => s.url && s.content);
    return {
      status: sources.length ? 'ok' : (text ? 'text_only' : 'empty'),
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
          contents: { highlights: { maxCharacters: 1200 } },
          ...(domains?.length ? { includeDomains: domains } : {}),
        }),
      },
      Math.max(1000, Math.min(30000, Number(timeoutMs) || 30000))
    );
    const results = Array.isArray(data?.results) ? data.results : [];
    const sources = results.map((r, i) => normalizeSource({
      provider: 'exa',
      title: r.title,
      url: r.url,
      snippet: r.highlights?.join(' '),
      content: r.highlights?.join(' ') || r.text,
      publishedAt: r.publishedDate,
      score: r.score,
    }, i)).filter(s => s.url && s.content);
    return { status: sources.length ? 'ok' : 'empty', text: formatSources(sources, startIndex), sources };
  } catch (error) {
    return { status: 'error', text: '', sources: [], error: error.message };
  }
}

async function searchSecondaryProviders({ query, geminiKey, exaKey, fetchFn = fetch, startIndex = 0, domains = [], prefer = 'gemini', timeoutMs = 15000 }) {
  const order = prefer === 'exa'
    ? [['exa', exaKey], ['gemini', geminiKey]]
    : [['gemini', geminiKey], ['exa', exaKey]];
  const errors = [];
  for (const [provider, key] of order) {
    if (!key) continue;
    const result = provider === 'exa'
      ? await searchExa({ apiKey: key, query, fetchFn, startIndex, domains, timeoutMs })
      : await searchGeminiWeb({ apiKey: key, query, fetchFn, startIndex, timeoutMs });
    if (result.status === 'ok' && result.sources.length) return result;
    if (result.error) errors.push(`${provider}: ${result.error}`);
  }
  return { status: 'empty', text: '', sources: [], error: errors.join('; ') };
}

module.exports = { normalizeSource, formatSources, searchGeminiWeb, searchExa, searchSecondaryProviders };
