'use strict';

const crypto = require('crypto');

// Cache werdyktów walidatora. Ta sama odpowiedź sprawdzana przeciw tym samym źródłom
// (powtórzone pytanie, ponowna walidacja po naprawie, cache Tavily) daje ten sam wynik
// przy temperaturze 0, więc nie ma powodu płacić drugi raz wywołaniem i tokenami.
// Cache'ujemy tylko jednoznaczne werdykty; błędy techniczne i „inconclusive” zawsze liczymy od nowa.
const CACHEABLE_STATUSES = new Set(['accepted', 'rejected']);

function createVerdictCache({ ttlMs = 10 * 60 * 1000, max = 200, now = Date.now } = {}) {
  const entries = new Map();
  const stats = { hits: 0, misses: 0, stores: 0 };

  function key({ question = '', answer = '', evidence = '', model = '' } = {}) {
    return crypto.createHash('sha256')
      .update([model, question, answer, evidence].map(part => String(part || '')).join('\u0000'))
      .digest('hex');
  }

  function get(cacheKey) {
    const entry = entries.get(cacheKey);
    if (!entry) { stats.misses++; return null; }
    if (now() - entry.at > ttlMs) { entries.delete(cacheKey); stats.misses++; return null; }
    stats.hits++;
    return entry.value;
  }

  function set(cacheKey, value) {
    if (!value || !CACHEABLE_STATUSES.has(value.status) || value.technicalError) return false;
    if (entries.size >= max) entries.delete(entries.keys().next().value);
    entries.set(cacheKey, { at: now(), value });
    stats.stores++;
    return true;
  }

  return { key, get, set, stats, size: () => entries.size };
}

module.exports = { createVerdictCache, CACHEABLE_STATUSES };
