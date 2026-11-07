'use strict';

const LIVE_BADGE_STYLES = new Set(['BADGE_STYLE_TYPE_LIVE_NOW']);
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const MAX_VIDEO_CANDIDATES = 30;
const MAX_LIVE_PAGE_BYTES = 512 * 1024;

async function readLimitedPageText(response, maxBytes = MAX_LIVE_PAGE_BYTES) {
  const declaredLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Strona YouTube /live przekracza limit rozmiaru.');
  }

  const body = response?.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value?.byteLength || 0;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error('Strona YouTube /live przekracza limit rozmiaru.');
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, totalBytes).toString('utf8');
    } catch (error) {
      try { await reader.cancel(); } catch (_) {}
      throw error;
    }
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error('Strona YouTube /live przekracza limit rozmiaru.');
  }
  return text;
}

function czyBialyZnak(znak) {
  return znak === ' ' || znak === '\t' || znak === '\n' || znak === '\r' || znak === '\f' || znak === '\v';
}

function parseAssignedJson(html, variableName) {
  const source = String(html || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_LIVE_PAGE_BYTES) return null;
  const nazwa = variableName === 'ytInitialData' ? 'ytInitialData' : 'ytInitialPlayerResponse';
  let pozycja = 0;

  // Szukamy wyłącznie dwóch dozwolonych nazw przez indexOf. Nie budujemy regexu
  // z tekstu strony, która pochodzi z zewnętrznego źródła.
  while ((pozycja = source.indexOf(nazwa, pozycja)) !== -1) {
    let start = pozycja + nazwa.length;
    pozycja = start;
    while (start < source.length && czyBialyZnak(source[start])) start += 1;

    // Obsługa window["nazwa"] oraz klucza "nazwa": w obiekcie.
    if (source[start] === '"' || source[start] === "'") {
      start += 1;
      while (start < source.length && czyBialyZnak(source[start])) start += 1;
      if (source[start] === ']') {
        start += 1;
        while (start < source.length && czyBialyZnak(source[start])) start += 1;
      }
    }

    if (source[start] !== '=' && source[start] !== ':') continue;
    start += 1;
    while (start < source.length && czyBialyZnak(source[start])) start += 1;
    if (start >= source.length || (source[start] !== '{' && source[start] !== '[')) continue;

    const otwarte = [];
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
      else if (char === '{' || char === '[') otwarte.push(char);
      else if (char === '}' || char === ']') {
        const poprzedni = otwarte.pop();
        if ((char === '}' && poprzedni !== '{') || (char === ']' && poprzedni !== '[')) break;
        if (otwarte.length === 0) {
          try { return JSON.parse(source.slice(start, i + 1)); }
          catch { break; }
        }
      }
    }
  }
  return null;
}

function maEtykieteLive(obiekt) {
  const wartosci = [
    obiekt?.label,
    obiekt?.text?.simpleText,
    obiekt?.accessibilityData?.label,
  ];
  return wartosci.some(wartosc =>
    typeof wartosc === 'string' && wartosc.trim().toUpperCase() === 'LIVE'
  );
}

function hasLiveBadge(renderer) {
  if (!renderer || typeof renderer !== 'object') return false;
  if (renderer.isLive === true || renderer.isLiveNow === true) return true;

  const badges = Array.isArray(renderer.badges) ? renderer.badges : [];
  if (badges.some(badge => {
    const meta = badge?.metadataBadgeRenderer;
    return LIVE_BADGE_STYLES.has(meta?.style) || (!meta?.style && maEtykieteLive(meta));
  })) return true;

  const overlays = Array.isArray(renderer.thumbnailOverlays) ? renderer.thumbnailOverlays : [];
  return overlays.some(item => {
    const status = item?.thumbnailOverlayTimeStatusRenderer;
    return status?.style === 'LIVE' || maEtykieteLive(status);
  });
}

function pobierzVideoIdZRenderera(obiekt) {
  const id = obiekt?.videoId || obiekt?.navigationEndpoint?.watchEndpoint?.videoId;
  return VIDEO_ID_RE.test(id || '') ? id : null;
}

function analizujRenderery(data, limit = MAX_VIDEO_CANDIDATES, requireLiveBadge = true) {
  if (!data || typeof data !== 'object') {
    return { ids: [], liczbaObiektow: 0, rendereryVideo: 0, sygnalyLive: 0, limitPrzeszukiwania: false };
  }

  const stack = [data];
  const visitedObjects = new Set();
  const ids = new Set();
  let rendereryVideo = 0;
  let sygnalyLive = 0;

  while (stack.length && visitedObjects.size < 100000 && ids.size < limit) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visitedObjects.has(current)) continue;
    visitedObjects.add(current);

    const videoId = pobierzVideoIdZRenderera(current);
    if (videoId) {
      rendereryVideo += 1;
      const maLive = hasLiveBadge(current);
      if (maLive) sygnalyLive += 1;
      if (!requireLiveBadge || maLive) ids.add(videoId);
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return {
    ids: [...ids],
    liczbaObiektow: visitedObjects.size,
    rendereryVideo,
    sygnalyLive,
    limitPrzeszukiwania: stack.length > 0 && visitedObjects.size >= 100000,
  };
}

function findVideoIds(data, limit = MAX_VIDEO_CANDIDATES, requireLiveBadge = false) {
  return analizujRenderery(data, limit, requireLiveBadge).ids;
}

function findLiveVideoIds(data, limit = 20) {
  return analizujRenderery(data, limit).ids;
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

function analizujStroneLive(html, finalUrl) {
  const source = String(html || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_LIVE_PAGE_BYTES) {
    return { ids: [], diagnostyka: { znalezionoInitialData: false, znalezionoPlayerResponse: false, liczbaObiektow: 0, rendereryVideo: 0, sygnalyLive: 0, limitPrzeszukiwania: false, limitRozmiaruHtml: true, redirectVideoId: false } };
  }
  const ids = new Set();
  const redirectedId = videoIdFromUrl(finalUrl);
  if (redirectedId) ids.add(redirectedId);
  const playerResponse = parseAssignedJson(source, 'ytInitialPlayerResponse');
  const playerVideoId = playerResponse?.videoDetails?.videoId;
  if (playerResponse?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true &&
      VIDEO_ID_RE.test(playerVideoId || '')) ids.add(playerVideoId);

  const initialData = parseAssignedJson(source, 'ytInitialData');
  const analiza = analizujRenderery(initialData, 20);
  for (const id of analiza.ids) ids.add(id);

  return {
    ids: [...ids].slice(0, MAX_VIDEO_CANDIDATES),
    diagnostyka: {
      znalezionoInitialData: Boolean(initialData),
      znalezionoPlayerResponse: Boolean(playerResponse),
      liczbaObiektow: analiza.liczbaObiektow,
      rendereryVideo: analiza.rendereryVideo,
      sygnalyLive: analiza.sygnalyLive,
      limitPrzeszukiwania: analiza.limitPrzeszukiwania,
      redirectVideoId: Boolean(redirectedId),
    },
  };
}

function extractLiveVideoIds(html, finalUrl) {
  return analizujStroneLive(html, finalUrl).ids;
}
// Backward-compatible strict helper: unlike discoverLiveVideoId, this only
// returns IDs with an explicit LIVE signal (or a direct /live redirect).
function extractLiveVideoId(html, finalUrl) {
  const redirected = videoIdFromUrl(finalUrl);
  if (redirected) return redirected;
  const source = String(html || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_LIVE_PAGE_BYTES) return null;
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
    const html = await readLimitedPageText(response);
    const analizaStrony = analizujStroneLive(html, response.url || url);
    pageCandidates = analizaStrony.ids;
    if (!pageCandidates.length) {
      const d = analizaStrony.diagnostyka;
      console.warn('[YouTube LIVE] Brak kandydatów dla ' + channelId +
        ' (HTTP ' + response.status + ', HTML: ' + html.length + ' znaków, ' +
        'ytInitialData: ' + (d.znalezionoInitialData ? 'tak' : 'nie') + ', ' +
        'ytInitialPlayerResponse: ' + (d.znalezionoPlayerResponse ? 'tak' : 'nie') + ', ' +
        'obiekty: ' + d.liczbaObiektow + ', renderery video: ' + d.rendereryVideo + ', ' +
        'sygnały LIVE: ' + d.sygnalyLive + ', limit DFS: ' + (d.limitPrzeszukiwania ? 'osiągnięty' : 'nie') +
        ', URL: ' + (response.url || url) + ').');
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
