'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBillyCmResponse } = require('../billy-cm');

test('Billy !cm assigns a deterministic cached 1–30 value per user and stream', () => {
  const cache = {};
  const first = buildBillyCmResponse({ cache, streamKey: 'stream-1', nick: 'Viewer', message: '!cm', rng: () => 0 });
  const repeat = buildBillyCmResponse({ cache, streamKey: 'stream-1', nick: 'Viewer', message: '!cm', rng: () => 0.99999 });
  assert.equal(first.value, 1);
  assert.equal(repeat.value, 1);
  assert.equal(repeat.changed, false);
  assert.match(first.response, /@Viewer ma 1 cm/);
});

test('Billy !cm accepts a target and normalizes the cache key without changing display casing', () => {
  const cache = {};
  const result = buildBillyCmResponse({ cache, streamKey: 'stream-1', nick: 'Sender', message: '!cm @MiXal', rng: () => 0.5 });
  assert.equal(result.value, 16);
  assert.match(result.response, /@MiXal ma 16 cm/);
  const repeat = buildBillyCmResponse({ cache, streamKey: 'stream-1', nick: 'Other', message: '!cm mixal', rng: () => 0 });
  assert.equal(repeat.value, 16);
});

test('Billy !cm retains values only for the active stream and resets assignments for a new stream', () => {
  const cache = {};
  const first = buildBillyCmResponse({ cache, streamKey: 'stream-1', nick: 'Viewer', message: '!cm', rng: () => 0 });
  const next = buildBillyCmResponse({ cache, streamKey: 'stream-2', nick: 'Viewer', message: '!cm', rng: () => 0.99999 });
  assert.equal(first.value, 1);
  assert.equal(next.value, 30);
  assert.equal(Object.keys(cache).length, 1);
  assert.ok(Object.keys(cache)[0].startsWith('twitch:billybulka:stream-2:'));
});

test('Billy !cm migrates old cache assignments only when the stream key matches', () => {
  const cache = {};
  const legacyCache = { streamKey: 'stream-1', users: { viewer: 22 } };
  const restored = buildBillyCmResponse({ cache, streamKey: 'stream-1', nick: 'Viewer', message: '!cm', rng: () => 0, legacyCache });
  assert.equal(restored.value, 22);
  const fresh = buildBillyCmResponse({ cache: {}, streamKey: 'stream-2', nick: 'Viewer', message: '!cm', rng: () => 0, legacyCache });
  assert.equal(fresh.value, 1);
});

test('Billy !cm rejects unrelated messages and explains when stream identity is not ready', () => {
  const cache = {};
  assert.equal(buildBillyCmResponse({ cache, streamKey: 'stream-1', nick: 'Viewer', message: '!cm something extra' }), null);
  const unavailable = buildBillyCmResponse({ cache, streamKey: null, nick: 'Viewer', message: '!cm' });
  assert.match(unavailable.response, /nie mam jeszcze identyfikatora tego streama/);
  assert.equal(unavailable.changed, false);
});
