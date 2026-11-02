'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTwitchUserIdCache, parseRetryAfterMs,
  validateTwitchEventSubReconnectUrl, createTwitchHelixRequester,
} = require('../twitch/api-utils');

test('user ID cache expires entries and refreshes LRU order', () => {
  let time = 100;
  const cache = createTwitchUserIdCache({ ttlMs: 50, maxEntries: 2, now: () => time });
  cache.set('a', '1'); cache.set('b', '2');
  assert.equal(cache.get('a'), '1');
  cache.set('c', '3');
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), '1');
  time = 149;
  assert.equal(cache.get('a'), '1');
  time = 151;
  assert.equal(cache.get('a'), null);
  assert.equal(cache.size, 0);
});

test('cache skips empty IDs and enforces its size limit', () => {
  const cache = createTwitchUserIdCache({ maxEntries: 1 });
  cache.set('empty', null); cache.set('one', '1'); cache.set('two', '2');
  assert.equal(cache.get('empty'), null);
  assert.equal(cache.get('one'), null);
  assert.equal(cache.get('two'), '2');
});

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('2', 0), 2000);
  assert.equal(parseRetryAfterMs(new Date(5000).toUTCString(), 0), 5000);
  assert.equal(parseRetryAfterMs('invalid', 0), null);
});

test('EventSub reconnect URL preserves Twitch session path/query and rejects untrusted origins', () => {
  const valid = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30&session_id=abc';
  assert.equal(validateTwitchEventSubReconnectUrl(valid), valid);
  assert.equal(validateTwitchEventSubReconnectUrl('https://eventsub.wss.twitch.tv/ws?x=1'), null);
  assert.equal(validateTwitchEventSubReconnectUrl('wss://attacker.example/ws?x=1'), null);
  assert.equal(validateTwitchEventSubReconnectUrl('wss://user:pass@eventsub.wss.twitch.tv/ws'), null);
  assert.equal(validateTwitchEventSubReconnectUrl('wss://eventsub.wss.twitch.tv:444/ws'), null);
});

test('Helix requester retries 429 using Retry-After', async () => {
  let time = 0; const delays = []; let calls = 0;
  const requester = createTwitchHelixRequester(async () => {
    calls += 1;
    return calls === 1
      ? { status: 429, headers: { get: () => '2' } }
      : { status: 200 };
  }, {
    maxRetries: 2, maxRetryDelayMs: 5000, now: () => time,
    sleep: async ms => { delays.push(ms); time += ms; }, logger: { warn() {} },
  });
  const response = await requester('https://api.twitch.tv/helix/users', {}, 3000);
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test('Helix requester stops after the configured retry budget', async () => {
  let calls = 0;
  const requester = createTwitchHelixRequester(async () => {
    calls += 1; return { status: 429, headers: { get: () => '0' } };
  }, { maxRetries: 1, sleep: async () => {}, logger: { warn() {} } });
  const response = await requester('https://api.twitch.tv/helix/users', {}, 3000);
  assert.equal(response.status, 429);
  assert.equal(calls, 2);
});
