'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { oznaczUzycieHistorii, ograniczHistorieRozmow } = require('../ai/history');

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

test('history eviction keeps all entries within the configured limit', () => {
  const histories = { a: [], b: [] };
  const usage = { a: 1, b: 2 };
  assert.deepEqual(ograniczHistorieRozmow(histories, usage, 2), []);
  assert.equal(ograniczHistorieRozmow(histories, usage, 0).length, 2);
  assert.deepEqual(histories, {});
  assert.deepEqual(usage, {});
});
