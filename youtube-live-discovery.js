'use strict';

const LIVE_BADGE_STYLES = new Set(['BADGE_STYLE_TYPE_LIVE_NOW']);

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
  for (const badge of badges) {
    const metadata = badge && badge.metadataBadgeRenderer;
    if (metadata && LIVE_BADGE_STYLES.has(metadata.style)) return true;
  }

  const overlays = Array.isArray(renderer.thumbnailOverlays) ? renderer.thumbnailOverlays : [];
  return overlays.some(item =>
    item && item.thumbnailOverlayTimeStatusRenderer &&
    item.thumbnailOverlayTimeStatusRenderer.style === 'LIVE'
  );
}

function findLiveVideoId(data) {
  if (!data || typeof data !== 'object') return null;
  const stack = [data];
  let visited = 0;

  while (stack.length && visited < 100000) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    visited += 1;

    if (typeof current.videoId === 'string' &&
        /^[a-zA-Z0-9_-]{11}$/.test(current.videoId) &&
        hasLiveBadge(current)) {
      return current.videoId;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const livePathMatch = url.pathname.match(/^\/live\/([a-zA-Z0-9_-]{11})$/);
    if (livePathMatch) return livePathMatch[1];
  } catch {}
  return null;
}

function extractLiveVideoId(html, finalUrl) {
  const redirectedVideoId = videoIdFromUrl(finalUrl);
  if (redirectedVideoId) return redirectedVideoId;

  const playerResponse = parseAssignedJson(html, 'ytInitialPlayerResponse');
  const playerLive = playerResponse &&
    playerResponse.microformat &&
    playerResponse.microformat.playerMicroformatRenderer &&
    playerResponse.microformat.playerMicroformatRenderer.liveBroadcastDetails &&
    playerResponse.microformat.playerMicroformatRenderer.liveBroadcastDetails.isLiveNow === true;
  const playerVideoId = playerResponse && playerResponse.videoDetails && playerResponse.videoDetails.videoId;
  if (playerLive && typeof playerVideoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(playerVideoId)) {
    return playerVideoId;
  }

  const initialData = parseAssignedJson(html, 'ytInitialData');
  return findLiveVideoId(initialData);
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
    return extractLiveVideoId(html, response.url || url);
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
  findLiveVideoId,
  parseAssignedJson,
};
