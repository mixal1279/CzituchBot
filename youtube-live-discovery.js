'use strict';

const LIVE_BADGE_STYLES = new Set(['BADGE_STYLE_TYPE_LIVE_NOW']);
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function parseAssignedJson(html, variableName) {
  const source = String(html || '');
  const marker = new RegExp(variableName + '\\s*=\\s*');
  const match = marker.exec(source);
  if (!match) return null;
  const start = source.indexOf('{', match.index + match[0].length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(source.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

function hasLiveBadge(renderer) {
  if (!renderer || typeof renderer !== 'object') return false;
  if (renderer.isLive === true || renderer.isLiveNow === true) return true;
  const badges = Array.isArray(renderer.badges) ? renderer.badges : [];
  if (badges.some(badge => LIVE_BADGE_STYLES.has(badge?.metadataBadgeRenderer?.style))) return true;
  const overlays = Array.isArray(renderer.thumbnailOverlays) ? renderer.thumbnailOverlays : [];
  return overlays.some(item => item?.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE');
}

function findLiveVideoIds(data, limit = 20) {
  if (!data || typeof data !== 'object') return [];
  const stack = [data];
  const visitedObjects = new Set();
  const ids = new Set();
  while (stack.length && visitedObjects.size < 100000 && ids.size < limit) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visitedObjects.has(current)) continue;
    visitedObjects.add(current);
    if (VIDEO_ID_RE.test(current.videoId || '') && hasLiveBadge(current)) ids.add(current.videoId);
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [...ids];
}

function findLiveVideoId(data) {
  return findLiveVideoIds(data, 1)[0] || null;
}

function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      return id && VIDEO_ID_RE.test(id) ? id : null;
    }
    const match = url.pathname.match(/^\/live\/([a-zA-Z0-9_-]{11})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractLiveVideoIds(html, finalUrl) {
  const ids = new Set();
  const redirectedVideoId = videoIdFromUrl(finalUrl);
  if (redirectedVideoId) ids.add(redirectedVideoId);

  const playerResponse = parseAssignedJson(html, 'ytInitialPlayerResponse');
  const playerLive = playerResponse?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true;
  const playerVideoId = playerResponse?.videoDetails?.videoId;
  if (playerLive && VIDEO_ID_RE.test(playerVideoId || '')) ids.add(playerVideoId);

  const initialData = parseAssignedJson(html, 'ytInitialData');
  for (const id of findLiveVideoIds(initialData, 20)) ids.add(id);
  return [...ids];
}

function extractLiveVideoId(html, finalUrl) {
  return extractLiveVideoIds(html, finalUrl)[0] || null;
}

async function discoverLiveVideoId(channelId, options) {
  const opts = options || {};
  if (typeof channelId !== 'string' || !/^UC[a-zA-Z0-9_-]{20,}$/.test(channelId)) {
    throw new TypeError('Nieprawidłowy YouTube Channel ID.');
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Środowisko Node.js nie udostępnia fetch().');

  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(1000, opts.timeoutMs) : 12000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = 'https://www.youtube.com/channel/' + encodeURIComponent(channelId) + '/live?hl=en';
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
      },
    });
    if (!response.ok) throw new Error('Strona YouTube /live zwróciła HTTP ' + response.status + '.');
    const html = await response.text();
    const candidates = extractLiveVideoIds(html, response.url || url);
    if (!candidates.length) return null;

    // Redirect i HTML są wyłącznie źródłami kandydatów. Produkcja przekazuje
    // verifyVideo, które potwierdza właściciela i aktywny Live Chat przez Data API.
    if (typeof opts.verifyVideo !== 'function) return candidates[0];
    for (const videoId of candidates) {
      const verified = await opts.verifyVideo(videoId, channelId);
      if (verified) return videoId;
    }
    return null;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Timeout ' + timeoutMs + ' ms podczas pobierania strony YouTube /live.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  discoverLiveVideoId,
  extractLiveVideoId,
  extractLiveVideoIds,
  findLiveVideoId,
  findLiveVideoIds,
  parseAssignedJson,
};
