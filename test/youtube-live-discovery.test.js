'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverLiveVideoId,
  extractLiveVideoId,
  extractLiveVideoIds,
  findLiveVideoId,
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

test('wykrywa videoId z rendererów bez badge LIVE, pozostawiając weryfikację Data API', () => {
  const html = assigned('ytInitialData', {
    contents: { videoRenderer: { videoId: VIDEO_ID, title: { simpleText: 'Stream' } } },
  });
  assert.deepEqual(extractLiveVideoIds(html), [VIDEO_ID]);
});

test('wykrywa videoId bezpośrednio w HTML, gdy format ytInitialData się zmieni', () => {
  const html = '<script>window.ytData = {"videoId":"' + VIDEO_ID + '"};</script>';
  assert.deepEqual(extractLiveVideoIds(html), [VIDEO_ID]);
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

test('rzuca błąd dla nieprawidłowego Channel ID', async () => {
  await assert.rejects(() => discoverLiveVideoId('not-a-channel'), TypeError);
});

test('wymaga zgodnego właściciela i aktywnego Live Chat ID', () => {
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: CHANNEL_ID },
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), true);
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: 'UC0000000000000000000000' },
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), false);
  assert.equal(isVerifiedLiveVideo({
    snippet: {},
    liveStreamingDetails: { activeLiveChatId: 'chat-123' },
  }, CHANNEL_ID), false);
  assert.equal(isVerifiedLiveVideo({
    snippet: { channelId: CHANNEL_ID },
    liveStreamingDetails: {},
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
