'use strict';

const LIVE_BADGE_STYLES = new Set(['BADGE_STYLE_TYPE_LIVE_NOW']);
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const MAX_VIDEO_CANDIDATES = 30;

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

function findVideoIds(data, limit = MAX_VIDEO_CANDIDATES, requireLiveBadge = false) {
  if (!data || typeof data !== 'object') return [];
  const stack = [data];
  const visitedObjects = new Set();
  const ids = new Set();
  while (stack.length && visitedObjects.size < 100000 && ids.size < limit) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visitedObjects.has(current)) continue;
    visitedObjects.add(current);
    if (VIDEO_ID_RE.test(current.videoId || '') && (!requireLiveBadge || hasLiveBadge(current))) {
      ids.add(current.videoId);
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [...ids];
}

function findLiveVideoIds(data, limit = 20) {
  return findVideoIds(data, limit, true);
}

function findLiveVideoId(data) {
  return findLiveVideoIds(data, 1)[0] || null;
}

function isLiveVideoFromChannel(video, expectedChannelId) {
  return Boolean(
    video &&
    typeof expectedChannelId === 'string' &&
    video.snippet?.channelId === expectedChannelId &&
    video.snippet?.liveBroadcastContent === 'live'
  );
}

// Czat jest osobną funkcją transmisji. Jego brak nie oznacza, że kanał jest offline.
function isVerifiedLiveVideo(video, expectedChannelId) {
  return Boolean(
    isLiveVideoFromChannel(video, expectedChannelId) &&
    typeof video.liveStreamingDetails?.activeLiveChatId === 'string' &&
    video.liveStreamingDetails.activeLiveChatId.length > 0
  );
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
  const source = String(html || '');
  const ids = new Set();
  const add = id => {
    if (VIDEO_ID_RE.test(id || '') && ids.size < MAX_VIDEO_CANDIDATES) ids.add(id);
  };

  add(videoIdFromUrl(finalUrl));

  const playerResponse = parseAssignedJson(source, 'ytInitialPlayerResponse');
  const playerVideoId = playerResponse?.videoDetails?.videoId;
  if (playerResponse?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true) {
    add(playerVideoId);
  }

  const initialData = parseAssignedJson(source, 'ytInitialData');
  for (const id of findLiveVideoIds(initialData, 20)) add(id);



  return [...ids];
}

// Backward-compatible strict helper: unlike discoverLiveVideoId, this only
// returns IDs with an explicit LIVE signal (or a direct /live redirect).
function extractLiveVideoId(html, finalUrl) {
  const redirected = videoIdFromUrl(finalUrl);
  if (redirected) return redirected;
  const source = String(html || '');
  const playerResponse = parseAssignedJson(source, 'ytInitialPlayerResponse');
  const playerVideoId = playerResponse?.videoDetails?.videoId;
  if (
    playerResponse?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true &&
    VIDEO_ID_RE.test(playerVideoId || '')
  ) return playerVideoId;
  const initialData = parseAssignedJson(source, 'ytInitialData');
  return findLiveVideoId(initialData);
}

async function discoverLiveVideoId(channelId, options) {
  const opts = options || {};
  if (typeof channelId !== 'string' || channelId.length !== 24 || !/^UC[a-zA-Z0-9_-]{22}$/.test(channelId)) {
    throw new TypeError('Nieprawidłowy YouTube Channel ID.');
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Środowisko Node.js nie udostępnia fetch().');
  if (typeof opts.verifyVideo !== 'function' && typeof opts.verifyVideos !== 'function') {
    throw new TypeError('discoverLiveVideoId wymaga funkcji verifyVideo lub verifyVideos.');
  }

  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(1000, opts.timeoutMs) : 12000;
  const url = 'https://www.youtube.com/channel/' + encodeURIComponent(channelId) + '/live?hl=en';
  let pageError = null;
  let pageCandidates = [];

  // Źródło podstawowe: publiczna strona kanału /live.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'follow', signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
      },
    });
    if (!response.ok) throw new Error('Strona YouTube /live zwróciła HTTP ' + response.status + '.');
    const html = await response.text();
    pageCandidates = extractLiveVideoIds(html, response.url || url);
    if (!pageCandidates.length) {
      console.warn('[YouTube LIVE] Strona /live nie zwróciła kandydatów videoId dla kanału ' + channelId +
        ' (HTTP ' + response.status + ', HTML: ' + html.length + ' znaków, URL: ' + (response.url || url) + ').');
    }
  } catch (error) {
    pageError = error?.name === 'AbortError'
      ? new Error('Timeout ' + timeoutMs + ' ms podczas pobierania strony YouTube /live.')
      : error;
    console.warn('[YouTube LIVE] Źródło /live niedostępne dla ' + channelId + ': ' + pageError.message);
  } finally {
    clearTimeout(timeout);
  }

  const checked = new Set();
  async function verifyCandidates(candidates) {
    const unique = [...new Set((candidates || []).filter(id => VIDEO_ID_RE.test(id || '') && !checked.has(id)))];
    unique.forEach(id => checked.add(id));
    if (!unique.length) return null;
    if (typeof opts.verifyVideos === 'function') {
      return opts.verifyVideos(unique, channelId);
    }
    // Kompatybilność wsteczna dla integracji/testów używających verifyVideo.
    for (const videoId of unique) {
      if (await opts.verifyVideo(videoId, channelId)) return videoId;
    }
    return null;
  }

  const pageMatch = await verifyCandidates(pageCandidates);
  if (pageMatch) return pageMatch;

  // Źródło zapasowe: oficjalne search.list(eventType=live).
  let fallbackError = null;
  let fallbackSkipped = false;
  let fallbackCompleted = false;
  if (typeof opts.searchLive === 'function') {
    try {
      const apiCandidates = await opts.searchLive(channelId);
      if (apiCandidates === null) {
        fallbackSkipped = true;
      } else {
        fallbackCompleted = true;
        const apiMatch = await verifyCandidates(apiCandidates);
        if (apiMatch) return apiMatch;
      }
    } catch (error) {
      fallbackError = error;
      console.warn('[YouTube LIVE] Zapasowe wyszukiwanie API nie powiodło się dla ' + channelId + ': ' + error.message);
    }
  }

  if (opts.throwIfAllSourcesFail === true) {
    // Brak kandydata na stronie /live nie jest dowodem, że kanał jest offline.
    // Jeśli źródło zapasowe zawiodło lub jest w cooldownie, zgłaszamy stan
    // nierozstrzygnięty zamiast zwracać null, które watcher interpretuje jako offline.
    if (fallbackError) {
      const error = new Error(
        'Nie udało się potwierdzić stanu LIVE. ' +
        (pageError ? '/live: ' + pageError.message + '; ' : '/live nie zwróciło kandydata; ') +
        'API: ' + fallbackError.message
      );
      error.code = 'LIVE_DISCOVERY_SOURCES_FAILED';
      throw error;
    }
    if (fallbackSkipped) {
      const error = new Error('Nie udało się potwierdzić stanu LIVE: zapasowe wyszukiwanie YouTube jest chwilowo w cooldownie.');
      error.code = 'LIVE_DISCOVERY_DEFERRED';
      throw error;
    }
    if (pageError && !fallbackCompleted) throw pageError;
  }
  return null;
}

module.exports = {
  discoverLiveVideoId,
  extractLiveVideoId,
  extractLiveVideoIds,
  findLiveVideoId,
  findLiveVideoIds,
  isLiveVideoFromChannel,
  isVerifiedLiveVideo,
  parseAssignedJson,
};
