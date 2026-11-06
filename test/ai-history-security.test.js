'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { oznaczUzycieHistorii, ograniczHistorieRozmow } = require('../ai/history');

test('history usage tracking rejects prototype-sensitive keys and Object.prototype', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    assert.equal(oznaczUzycieHistorii({}, key), false);
  }
  assert.equal(oznaczUzycieHistorii(Object.prototype, 'polluted'), false);
  assert.equal(Object.prototype.polluted, undefined);
});

test('history usage tracking accepts plain and null-prototype dictionaries', () => {
  const plain = {};
  const nullPrototype = Object.create(null);
  assert.equal(oznaczUzycieHistorii(plain, 'twitch:channel:user', 123), true);
  assert.equal(plain['twitch:channel:user'], 123);
  assert.equal(oznaczUzycieHistorii(nullPrototype, 'youtube:channel:UCabc', 456), true);
  assert.equal(nullPrototype['youtube:channel:UCabc'], 456);
});

test('history pruning removes dangerous own keys without prototype mutation', () => {
  const history = JSON.parse('{"__proto__":{"polluted":true},"constructor":[],"safe":[],"older":[]}');
  const lastUsed = JSON.parse('{"__proto__":1,"constructor":2,"safe":3,"older":1}');
  const deleted = ograniczHistorieRozmow(history, lastUsed, 0);
  assert.equal(Object.hasOwn(history, '__proto__'), false);
  assert.equal(Object.hasOwn(history, 'constructor'), false);
  assert.equal(Object.hasOwn(lastUsed, '__proto__'), false);
  assert.equal(Object.hasOwn(lastUsed, 'constructor'), false);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(deleted.sort(), ['older', 'safe']);
});

test('history pruning rejects Object.prototype and custom-prototype dictionaries', () => {
  assert.deepEqual(ograniczHistorieRozmow(Object.prototype, {}), []);
  const custom = Object.create({ inherited: true });
  custom.entry = [];
  assert.deepEqual(ograniczHistorieRozmow(custom, {}, 0), []);
  assert.equal(custom.entry.length, 0);
});
