'use strict';

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 6;
const DEFAULT_BREAKER_COOLDOWN_MS = 90 * 1000;
const MIN_BREAKER_COOLDOWN_MS = 30 * 1000;

/**
 * Globalny breaker dla modelu 120B rozdzielony od okna limitu.
 * Okno (cap 6/h) i breaker (cooldown po 429) mają własne deadline'y — TPM
 * nie może zamykać 120B na godzinę, TPD musi respektować Retry-After.
 */
function create120bBreaker(options = {}) {
  const windowMs = Math.max(1, Number(options.windowMs) || DEFAULT_WINDOW_MS);
  const maxRequests = Math.max(1, Number(options.maxRequests) || DEFAULT_MAX_REQUESTS);
  const defaultCooldownMs = Math.max(
    MIN_BREAKER_COOLDOWN_MS,
    Number(options.defaultCooldownMs) || DEFAULT_BREAKER_COOLDOWN_MS,
  );
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  let requestsInWindow = 0;
  let windowEndsAt = now() + windowMs;
  let breakerOpenUntil = 0;
  let breakerOpen = false;

  // Reset okna tylko wtedy, gdy minęło zarówno okno, jak i breaker.
  // Zachowanie zgodne z poprzednim kodem w czituch_bot.js.
  function resetWindowIfExpired(ts) {
    if (ts >= windowEndsAt && ts >= breakerOpenUntil) {
      requestsInWindow = 0;
      windowEndsAt = ts + windowMs;
      breakerOpenUntil = 0;
      breakerOpen = false;
    }
  }

  function isOpen(ts = now()) {
    if (!breakerOpen) return false;
    if (ts >= breakerOpenUntil) {
      breakerOpen = false;
      breakerOpenUntil = 0;
      return false;
    }
    return true;
  }

  function reserve(requestId = '-') {
    const ts = now();
    resetWindowIfExpired(ts);
    if (isOpen(ts)) {
      return { ok: false, reason: 'circuit_breaker_open', until: breakerOpenUntil, requestId };
    }
    if (requestsInWindow >= maxRequests) {
      return { ok: false, reason: 'quota_exhausted', used: requestsInWindow, max: maxRequests, requestId };
    }
    requestsInWindow++;
    return { ok: true, used: requestsInWindow, max: maxRequests, requestId };
  }

  function trip(reason = 'limit', cooldownMs) {
    const ts = now();
    const ms = Math.max(
      MIN_BREAKER_COOLDOWN_MS,
      Number(cooldownMs) || defaultCooldownMs,
    );
    breakerOpenUntil = ts + ms;
    breakerOpen = true;
    return { until: breakerOpenUntil, cooldownMs: ms, reason };
  }

  function snapshot() {
    const ts = now();
    return {
      requestsInWindow,
      maxRequests,
      windowMs,
      windowEndsAt,
      breakerOpen: isOpen(ts),
      breakerOpenUntil: breakerOpen ? breakerOpenUntil : 0,
    };
  }

  function reset() {
    requestsInWindow = 0;
    windowEndsAt = now() + windowMs;
    breakerOpenUntil = 0;
    breakerOpen = false;
  }

  return { reserve, trip, isOpen, snapshot, reset };
}

module.exports = {
  create120bBreaker,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_BREAKER_COOLDOWN_MS,
  MIN_BREAKER_COOLDOWN_MS,
};
