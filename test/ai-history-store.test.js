'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { oznaczUzycieHistorii, ograniczHistorieRozmow, zbudujKluczHistorii } = require('../ai/history');

test('conversation keys use stable platform identities and isolate channels', () => {
  const youtubeA = zbudujKluczHistorii('youtube', 'edzzi', 'UC123');
  const youtubeB = zbudujKluczHistorii('youtube', 'edzzi', 'UC456');
  const twitch = zbudujKluczHistorii('twitch', 'edzzi', 'UC123');
  const otherChannel = zbudujKluczHistorii('youtube', 'angie28', 'UC123');
  assert.equal(youtubeA, 'youtube:edzzi:uc123');
  assert.notEqual(youtubeA, youtubeB);
  assert.notEqual(youtubeA, twitch);
  assert.notEqual(youtubeA, otherChannel);
  assert.equal(zbudujKluczHistorii('youtube', 'edzzi', ''), 'youtube:edzzi:unknown');
});

test('conversation usage is tracked by the complete platform-channel-user key', () => {
  const usage = {};
  assert.equal(oznaczUzycieHistorii(usage, 'twitch:channel-a:user-1', 100), true);
  assert.equal(oznaczUzycieHistorii(usage, 'youtube:channel-a:user-1', 200), true);
  assert.equal(oznaczUzycieHistorii(usage, 'twitch:channel-b:user-1', 300), true);
  assert.deepEqual(usage, {
    'twitch:channel-a:user-1': 100,
    'youtube:channel-a:user-1': 200,
    'twitch:channel-b:user-1': 300,
  });
});

test('history eviction removes the least recently used conversation and its matching usage key', () => {
  const histories = {
    'twitch:a:user': [{ content: 'old' }],
    'youtube:a:user': [{ content: 'middle' }],
    'twitch:b:user': [{ content: 'recent' }],
  };
  const usage = {
    'twitch:a:user': 10,
    'youtube:a:user': 20,
    'twitch:b:user': 30,
    // A legacy nick-only entry must not affect eviction of scoped histories.
    user: 999,
  };

  assert.deepEqual(ograniczHistorieRozmow(histories, usage, 2), ['twitch:a:user']);
  assert.deepEqual(Object.keys(histories), ['youtube:a:user', 'twitch:b:user']);
  assert.equal(Object.hasOwn(usage, 'twitch:a:user'), false);
  assert.equal(usage.user, 999);
});

test('Twitch AI passes its full platform-channel-user scope into persistent memory', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');
  const start = source.indexOf('async function obslugaTwitch(');
  const end = source.indexOf('async function ', start + 1);
  assert.ok(start >= 0 && end > start, 'Twitch handler should exist');
  const handler = source.slice(start, end);
  assert.match(handler, /const historiaKlucz = `twitch:\$\{kanalNorm \|\| 'brak-kanalu'\}:\$\{login\}`/);
  assert.match(handler, /memoryUserId:\s*historiaKlucz/);
});

test('history eviction keeps all entries within the configured limit', () => {
  const histories = { a: [], b: [] };
  const usage = { a: 1, b: 2 };
  assert.deepEqual(ograniczHistorieRozmow(histories, usage, 2), []);
  assert.equal(ograniczHistorieRozmow(histories, usage, 0).length, 2);
  assert.deepEqual(histories, {});
  assert.deepEqual(usage, {});
});
