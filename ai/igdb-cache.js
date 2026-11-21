'use strict';

function utworzCacheIGDB({
  maxEntries = 100,
  ttlMs = 30 * 60 * 1000,
  negativeTtlMs = 5 * 60 * 1000,
  now = Date.now,
} = {}) {
  const limit = Number.isSafeInteger(maxEntries) && maxEntries > 0 ? maxEntries : 100;
  const positiveTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 30 * 60 * 1000;
  const negativeTtl = Number.isFinite(negativeTtlMs) && negativeTtlMs > 0 ? negativeTtlMs : 5 * 60 * 1000;
  const entries = new Map();
  const inFlight = new Map();
  const stats = { hits: 0, misses: 0, stores: 0, joined: 0 };

  function pobierz(key) {
    const entry = entries.get(key);
    if (!entry) return { hit: false, value: null };
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return { hit: false, value: null };
    }
    // Odczyt przesuwa wpis na koniec Map, utrzymując prosty LRU.
    entries.delete(key);
    entries.set(key, entry);
    stats.hits++;
    return { hit: true, value: entry.value };
  }

  function zapisz(key, value) {
    const negative = value == null || (Array.isArray(value) && value.length === 0);
    const ttl = negative ? negativeTtl : positiveTtl;
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttl });
    while (entries.size > limit) entries.delete(entries.keys().next().value);
    stats.stores++;
  }

  async function pobierzLubWczytaj(key, loader) {
    const cacheKey = String(key || '').trim().slice(0, 180);
    if (!cacheKey || typeof loader !== 'function') return null;
    const cached = pobierz(cacheKey);
    if (cached.hit) {
      return cached.value;
    }
    if (inFlight.has(cacheKey)) {
      stats.joined++;
      return inFlight.get(cacheKey);
    }

    stats.misses++;
    const promise = (async () => {
      try {
        const value = await loader();
        if (value !== undefined) zapisz(cacheKey, value);
        return value;
      } finally {
        inFlight.delete(cacheKey);
      }
    })();
    inFlight.set(cacheKey, promise);
    return promise;
  }

  function wyczysc() {
    entries.clear();
    inFlight.clear();
  }

  return {
    pobierzLubWczytaj,
    wyczysc,
    size: () => entries.size,
    stats,
  };
}

module.exports = { utworzCacheIGDB };
