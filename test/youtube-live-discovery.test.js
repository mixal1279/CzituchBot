'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverLiveVideoId,
  extractLiveVideoId,
  extractLiveVideoIds,
  findLiveVideoId,
  isLiveVideoFromChannel,
  isVerifiedLiveVideo,
} = require('../youtube-live-discovery');

const VIDEO_ID = 'a1b2c3d4e5F';
const OTHER_VIDEO_ID = 'z9y8x7w6v5U';
const CHANNEL_ID = 'UCANPTDOw4sbMwVhITet1Qbw';
const assigned = (name, value) => 'var ' + name + ' = ' + JSON.stringify(value) + ';';
const liveRenderer = videoId => ({
  videoId,
  badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW', label: 'LIVE' } }],
});

test('wykrywa videoRenderer z badge LIVE_NOW w ytInitialData', () => {
  const html = assigned('ytInitialData', { contents: { videoRenderer: liveRenderer(VIDEO_ID) } });
  assert.equal(extractLiveVideoId(html), VIDEO_ID);
});

test('zbiera wielu kandydatów LIVE zamiast zwracać przypadkowy pierwszy wynik', () => {
  const html = assigned('ytInitialData', {
    contents: { first: liveRenderer(OTHER_VIDEO_ID), second: liveRenderer(VIDEO_ID) },
  });
  assert.deepEqual(new Set(extractLiveVideoIds(html)), new Set([OTHER_VIDEO_ID, VIDEO_ID]));
});

test('ignoruje videoId z rendererów bez jawnego badge LIVE', () => {
  const html = assigned('ytInitialData', {
    contents: { videoRenderer: { videoId: VIDEO_ID, title: { simpleText: 'Stream' } } },
  });
  assert.deepEqual(extractLiveVideoIds(html), []);
});

test('ignoruje videoId znalezione w surowym HTML bez sygnału LIVE', () => {
  const html = '<script>window.ytData = {"videoId":"' + VIDEO_ID + '"};</script>';
  assert.deepEqual(extractLiveVideoIds(html), []);
});

test('nie uznaje zwykłego filmu ani zakończonej transmisji za potwierdzony LIVE', () => {
  assert.equal(findLiveVideoId({
    videoRenderer: {
      videoId: VIDEO_ID,
      badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_SIMPLE', label: 'LIVE' } }],
    },
  }), null);
  assert.equal(extractLiveVideoId(assigned('ytInitialPlayerResponse', {
    videoDetails: { videoId: VIDEO_ID, isLiveContent: true },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false } } },
  })), null);
});

test('obsługuje ytInitialPlayerResponse z isLiveNow=true', () => {
  const html = assigned('ytInitialPlayerResponse', {
    videoDetails: { videoId: VIDEO_ID },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true } } },
  });
  assert.equal(extractLiveVideoId(html), VIDEO_ID);
});

test('redirect do watch jest kandydatem, a nie potwierdzeniem kanału', () => {
  assert.equal(extractLiveVideoId('', 'https://www.youtube.com/watch?v=' + VIDEO_ID), VIDEO_ID);
});

test('obsługuje bezpośredni URL /live/VIDEO_ID', () => {
  assert.equal(extractLiveVideoId('', 'https://www.youtube.com/live/' + VIDEO_ID), VIDEO_ID);
});

test('weryfikuje kandydatów po kolei i wybiera dopiero poprawny kanał', async () => {
  const html = assigned('ytInitialData', {
    first: liveRenderer(VIDEO_ID),
    second: liveRenderer(OTHER_VIDEO_ID),
  });
  const checked = [];
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({ ok: true, status: 200, url, text: async () => html }),
    verifyVideo: async id => {
      checked.push(id);
      return id === VIDEO_ID;
    },
  });
  assert.equal(found, VIDEO_ID);
  assert.deepEqual(checked, [OTHER_VIDEO_ID, VIDEO_ID]);
});

test('nie akceptuje redirectu, jeśli oficjalna weryfikacja odrzuca obcy kanał', async () => {
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async () => ({
      ok: true, status: 200,
      url: 'https://www.youtube.com/watch?v=' + VIDEO_ID,
      text: async () => '',
    }),
    verifyVideo: async () => false,
  });
  assert.equal(found, null);
});

test('pobiera stronę kanału /live i parsuje jej HTML', async () => {
  let requestedUrl = '';
  const html = assigned('ytInitialData', { videoRenderer: liveRenderer(VIDEO_ID) });
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      assert.equal(options.redirect, 'follow');
      return { ok: true, status: 200, url, text: async () => html };
    },
    verifyVideo: async () => true,
  });
  assert.match(requestedUrl, new RegExp('/channel/' + CHANNEL_ID + '/live'));
  assert.equal(found, VIDEO_ID);
});

test('zwraca null, gdy strona kanału nie pokazuje żadnych kandydatów', async () => {
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({
      ok: true, status: 200, url,
      text: async () => assigned('ytInitialData', { contents: { twoColumnBrowseResultsRenderer: {} } }),
    }),
    verifyVideo: async () => true,
  });
  assert.equal(found, null);
});



test('nie łączy nieobiektowego ytInitialData z przypadkowym obiektem z dalszego HTML', () => {
  const html = 'var ytInitialData = null; window.other = {"videoId":"' + VIDEO_ID + '"};';
  assert.deepEqual(extractLiveVideoIds(html), []);
});

test('priorytetyzuje ID z redirectu /live przed innymi kandydatami strony', () => {
  const html = assigned('ytInitialData', {
    contents: { videoRenderer: liveRenderer(OTHER_VIDEO_ID) },
  });
  assert.equal(extractLiveVideoIds(html, 'https://www.youtube.com/watch?v=' + VIDEO_ID)[0], VIDEO_ID);
});

test('obsługuje alternatywne przypisanie window.ytInitialData', () => {
  const html = 'window.ytInitialData = ' + JSON.stringify({
    contents: { videoRenderer: liveRenderer(VIDEO_ID) },
  }) + ';';
  assert.equal(extractLiveVideoId(html), VIDEO_ID);
});

test('obsługuje window["ytInitialData"] i etykietę LIVE bez style', () => {
  const renderer = {
    videoId: VIDEO_ID,
    badges: [{ metadataBadgeRenderer: { label: 'LIVE' } }],
  };
  const html = 'window["ytInitialData"] = ' + JSON.stringify({ contents: { videoRenderer: renderer } }) + ';';
  assert.equal(extractLiveVideoId(html), VIDEO_ID);
});

test('obsługuje videoId w watchEndpoint renderera z jawnym sygnałem LIVE', () => {
  const renderer = {
    navigationEndpoint: { watchEndpoint: { videoId: VIDEO_ID } },
    thumbnailOverlays: [{
      thumbnailOverlayTimeStatusRenderer: { text: { simpleText: 'LIVE' } },
    }],
  };
  const html = 'var ytInitialData = ' + JSON.stringify({ contents: { richItemRenderer: { content: { videoRenderer: renderer } } } }) + ';';
  assert.equal(extractLiveVideoId(html), VIDEO_ID);
});

test('nie uznaje etykiety LIVE w tekście filmu bez sygnału LIVE za transmisję', () => {
  const renderer = {
    videoId: VIDEO_ID,
    title: { simpleText: 'LIVE: mój zwykły film' },
    badges: [{ metadataBadgeRenderer: { label: '4K' } }],
  };
  const html = 'var ytInitialData = ' + JSON.stringify({ contents: { videoRenderer: renderer } }) + ';';
  assert.deepEqual(extractLiveVideoIds(html), []);
});

test('rzuca błąd dla nieprawidłowego Channel ID', async () => {
  await assert.rejects(() => discoverLiveVideoId('not-a-channel'), TypeError);
});

test('odrzuca nadmiernie długi Channel ID przed wykonaniem fetch', async () => {
  let fetchCalls = 0;
  await assert.rejects(() => discoverLiveVideoId('UC' + 'A'.repeat(100000), {
    fetchImpl: async () => { fetchCalls++; throw new Error('fetch nie powinien wystartować'); },
    verifyVideo: async () => false,
  }), TypeError);
  assert.equal(fetchCalls, 0);
});

test('wymaga zgodnego właściciela i aktywnego Live Chat ID', () => {
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: CHANNEL_ID, liveBroadcastContent: 'live' },
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), true);
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: 'UC0000000000000000000000', liveBroadcastContent: 'live' },
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), false);
  assert.equal(isVerifiedLiveVideo({
    snippet: { liveBroadcastContent: 'live' },
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), false);
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: CHANNEL_ID, liveBroadcastContent: 'live' },
    liveStreamingDetails: {},
  }, CHANNEL_ID), false);
});

test('odrzuca transmisję bez statusu live nawet z aktywnym chat ID', () => {
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: CHANNEL_ID, liveBroadcastContent: 'none' },
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), false);
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: CHANNEL_ID, liveBroadcastContent: 'upcoming' },
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), false);
});

test('nie pozwala uruchomić discovery bez walidatora Data API', async () => {
  await assert.rejects(() => discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({
      ok: true, status: 200, url,
      text: async () => assigned('ytInitialData', { videoRenderer: liveRenderer(VIDEO_ID) }),
    }),
  }), /wymaga funkcji verifyVideo/);
});


test('rozpoznaje LIVE kanału niezależnie od dostępności czatu', () => {
  assert.equal(isLiveVideoFromChannel({
    snippet: { channelId: CHANNEL_ID, liveBroadcastContent: 'live' },
    liveStreamingDetails: {},
  }, CHANNEL_ID), true);
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: CHANNEL_ID, liveBroadcastContent: 'live' },
    liveStreamingDetails: {},
  }, CHANNEL_ID), false);
});

test('używa zapasowego search.list, gdy strona /live nie zwraca kandydatów', async () => {
  const html = assigned('ytInitialData', { contents: {} });
  let fallbackCalls = 0;
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({ ok: true, status: 200, url, text: async () => html }),
    searchLive: async channelId => {
      fallbackCalls += 1;
      assert.equal(channelId, CHANNEL_ID);
      return [OTHER_VIDEO_ID, VIDEO_ID];
    },
    verifyVideo: async id => id === VIDEO_ID,
  });
  assert.equal(found, VIDEO_ID);
  assert.equal(fallbackCalls, 1);
});

test('nie pyta zapasowego źródła ponownie dla duplikatu kandydata', async () => {
  const html = assigned('ytInitialData', { videoRenderer: liveRenderer(VIDEO_ID) });
  const checked = [];
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({ ok: true, status: 200, url, text: async () => html }),
    searchLive: async () => [VIDEO_ID, OTHER_VIDEO_ID],
    verifyVideo: async id => { checked.push(id); return id === OTHER_VIDEO_ID; },
  });
  assert.equal(found, OTHER_VIDEO_ID);
  assert.deepEqual(checked, [VIDEO_ID, OTHER_VIDEO_ID]);
});

test('weryfikuje kandydatów zbiorczo jednym wywołaniem verifyVideos', async () => {
  const html = assigned('ytInitialData', {
    first: liveRenderer(OTHER_VIDEO_ID),
    second: liveRenderer(VIDEO_ID),
  });
  const batches = [];
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({ ok: true, status: 200, url, text: async () => html }),
    verifyVideos: async (ids, channelId) => {
      batches.push({ ids, channelId });
      return ids.includes(VIDEO_ID) ? VIDEO_ID : null;
    },
  });
  assert.equal(found, VIDEO_ID);
  assert.equal(batches.length, 1);
  assert.deepEqual(new Set(batches[0].ids), new Set([OTHER_VIDEO_ID, VIDEO_ID]));
  assert.equal(batches[0].channelId, CHANNEL_ID);
});

test('weryfikacja zbiorcza nie sprawdza ponownie ID obecnego już w źródle podstawowym', async () => {
  const html = assigned('ytInitialData', { videoRenderer: liveRenderer(VIDEO_ID) });
  const batches = [];
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({ ok: true, status: 200, url, text: async () => html }),
    searchLive: async () => [VIDEO_ID, OTHER_VIDEO_ID],
    verifyVideos: async ids => {
      batches.push(ids);
      return null;
    },
  });
  assert.equal(found, null);
  assert.deepEqual(batches, [[VIDEO_ID], [OTHER_VIDEO_ID]]);
});

test('akceptuje wynik offline z API, gdy strona /live jest niedostępna', async () => {
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async () => { throw new Error('network unavailable'); },
    searchLive: async () => [],
    verifyVideo: async () => false,
    throwIfAllSourcesFail: true,
  });
  assert.equal(found, null);
});

test('nie oznacza kanału jako offline, gdy zapasowe search.list zawiedzie', async () => {
  const html = assigned('ytInitialData', { contents: {} });
  await assert.rejects(
    () => discoverLiveVideoId(CHANNEL_ID, {
      fetchImpl: async url => ({ ok: true, status: 200, url, text: async () => html }),
      searchLive: async () => { throw new Error('quotaExceeded'); },
      verifyVideo: async () => false,
      throwIfAllSourcesFail: true,
    }),
    error => error.code === 'LIVE_DISCOVERY_SOURCES_FAILED' && /quotaExceeded/.test(error.message)
  );
});

test('nie oznacza kanału jako offline, gdy fallback jest pominięty przez cooldown', async () => {
  const html = assigned('ytInitialData', { contents: {} });
  await assert.rejects(
    () => discoverLiveVideoId(CHANNEL_ID, {
      fetchImpl: async url => ({ ok: true, status: 200, url, text: async () => html }),
      searchLive: async () => null,
      verifyVideo: async () => false,
      throwIfAllSourcesFail: true,
    }),
    error => error.code === 'LIVE_DISCOVERY_DEFERRED'
  );
});



test('odrzuca HTML /live większy niż limit przed parsowaniem i weryfikacją kandydatów', async () => {
  const { extractLiveVideoIds, discoverLiveVideoId } = require('../youtube-live-discovery');
  const oversized = 'x'.repeat(512 * 1024 + 1);
  assert.deepEqual(extractLiveVideoIds(oversized), []);
  let verified = 0;
  const result = await discoverLiveVideoId('UCANPTDOw4sbMwVhITet1Qbw', {
    fetchImpl: async () => ({ ok: true, url: 'https://www.youtube.com/channel/UCANPTDOw4sbMwVhITet1Qbw/live', text: async () => oversized }),
    verifyVideo: async () => { verified++; return true; },
  });
  assert.equal(result, null);
  assert.equal(verified, 0);
});
