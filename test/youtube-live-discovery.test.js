'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverLiveVideoId,
  extractLiveVideoId,
  findLiveVideoId,
} = require('../youtube-live-discovery');

const VIDEO_ID = 'a1b2c3d4e5F';
const CHANNEL_ID = 'UCANPTDOw4sbMwVhITet1Qbw';

test('wykrywa videoRenderer z badge LIVE_NOW w ytInitialData', () => {
  const html = \`var ytInitialData = \${JSON.stringify({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [{
                  richItemRenderer: {
                    content: {
                      videoRenderer: {
                        videoId: VIDEO_ID,
                        badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW', label: 'LIVE' } }],
                      },
                    },
                  },
                }],
              },
            },
          },
        }],
      },
    },
  })};\`;
  assert.equal(extractLiveVideoId(html), VIDEO_ID);
});

test('nie uznaje zwykłego filmu ani zakończonej transmisji za live', () => {
  assert.equal(findLiveVideoId({
    videoRenderer: {
      videoId: VIDEO_ID,
      badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_SIMPLE', label: 'LIVE' } }],
    },
  }), null);
  assert.equal(extractLiveVideoId(\`var ytInitialPlayerResponse = \${JSON.stringify({
    videoDetails: { videoId: VIDEO_ID, isLiveContent: true },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false } } },
  })};\`), null);
});

test('obsługuje ytInitialPlayerResponse z isLiveNow=true', () => {
  const html = \`var ytInitialPlayerResponse = \${JSON.stringify({
    videoDetails: { videoId: VIDEO_ID, isLiveContent: true },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true } } },
  })};\`;
  assert.equal(extractLiveVideoId(html), VIDEO_ID);
});

test('obsługuje przekierowanie /live bezpośrednio do watch?v=', () => {
  assert.equal(extractLiveVideoId('', \`https://www.youtube.com/watch?v=\${VIDEO_ID}\`), VIDEO_ID);
});

test('pobiera stronę kanału /live i parsuje jej HTML bez wywołania Data API', async () => {
  let requestedUrl = '';
  const html = \`var ytInitialData = \${JSON.stringify({
    videoRenderer: {
      videoId: VIDEO_ID,
      thumbnailOverlays: [{
        thumbnailOverlayTimeStatusRenderer: { style: 'LIVE', text: { simpleText: 'LIVE' } },
      }],
    },
  })};\`;
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      assert.equal(options.redirect, 'follow');
      return {
        ok: true,
        status: 200,
        url,
        text: async () => html,
      };
    },
  });
  assert.match(requestedUrl, new RegExp(\`/channel/\${CHANNEL_ID}/live\`));
  assert.equal(found, VIDEO_ID);
});

test('zwraca null, gdy strona kanału nie pokazuje aktywnej transmisji', async () => {
  const found = await discoverLiveVideoId(CHANNEL_ID, {
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      url,
      text: async () => \`var ytInitialData = \${JSON.stringify({ contents: { twoColumnBrowseResultsRenderer: {} } })};\`,
    }),
  });
  assert.equal(found, null);
});
