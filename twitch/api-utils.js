'use strict';

function createTwitchUserIdCache({ ttlMs = 6 * 60 * 60 * 1000, maxEntries = 500, now = Date.now } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs musi być dodatni.');
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('maxEntries musi być dodatnią liczbą całkowitą.');
  const entries = new Map();
  function pruneExpired(timestamp = now()) {
    for (const [key, entry] of entries) if (entry.expiresAt <= timestamp) entries.delete(key);
  }
  return {
    get(key) {
      const normalizedKey = String(key);
      const entry = entries.get(normalizedKey);
      if (!entry) return null;
      if (entry.expiresAt <= now()) { entries.delete(normalizedKey); return null; }
      entries.delete(normalizedKey);
      entries.set(normalizedKey, entry);
      return entry.value;
    },
    set(key, value) {
      if (value === null || value === undefined || value === '') return;
      const timestamp = now();
      pruneExpired(timestamp);
      const normalizedKey = String(key);
      entries.delete(normalizedKey);
      entries.set(normalizedKey, { value: String(value), expiresAt: timestamp + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    delete(key) { return entries.delete(String(key)); },
    clear() { entries.clear(); },
    get size() { pruneExpired(); return entries.size; },
  };
}

function parseRetryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function parseRateLimitResetMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const timestampSeconds = Number(value);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) return null;
  return Math.max(0, Math.ceil(timestampSeconds * 1000 - now));
}

function validateTwitchEventSubReconnectUrl(reconnectUrl) {
  if (typeof reconnectUrl !== 'string' || !reconnectUrl) return null;
  try {
    const parsed = new URL(reconnectUrl);
    const allowedHost = 'eventsub.wss.twitch.tv';
    if (parsed.protocol !== 'wss:' || parsed.hostname !== allowedHost) return null;
    if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || parsed.hash) return null;
    return new URL(`${parsed.pathname}${parsed.search}`, `wss://${allowedHost}`).toString();
  } catch (_) { return null; }
}

function createTwitchHelixRequester(fetchFn, {
  maxRetries = 2,
  maxRetryDelayMs = 60_000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  logger = console,
} = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('fetchFn musi być funkcją.');
  let cooldownUntil = 0;
  return async function fetchTwitchHelix(url, options, timeoutMs) {
    let attempt = 0;
    while (true) {
      const waitForCooldown = Math.max(0, cooldownUntil - now());
      if (waitForCooldown > 0) await sleep(waitForCooldown);
      const response = await fetchFn(url, options, timeoutMs);
      if (response.status !== 429 || attempt >= maxRetries) return response;
      const retryAfter = parseRetryAfterMs(response.headers?.get?.('retry-after'), now())
        ?? parseRateLimitResetMs(response.headers?.get?.('ratelimit-reset'), now());
      const fallbackDelay = Math.min(1000 * (2 ** attempt), maxRetryDelayMs);
      const delay = Math.min(retryAfter ?? fallbackDelay, maxRetryDelayMs);
      cooldownUntil = Math.max(cooldownUntil, now() + delay);
      attempt += 1;
      logger.warn?.(`[Twitch Helix] HTTP 429 — ponawiam zapytanie za ${delay} ms (próba ${attempt}/${maxRetries}).`);
    }
  };
}

module.exports = { createTwitchUserIdCache, parseRetryAfterMs, parseRateLimitResetMs, validateTwitchEventSubReconnectUrl, createTwitchHelixRequester };
