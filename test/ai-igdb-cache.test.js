'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { utworzCacheIGDB } = require('../ai/igdb-cache');

test('IGDB cache reuses positive results until TTL expires', async () => {
  let now = 100;
  let calls = 0;
  const cache = utworzCacheIGDB({ ttlMs: 1000, now: () => now });
  const loader = async () => { calls++; return [{ name: 'Portal' }]; };
  assert.deepEqual(await cache.pobierzLubWczytaj('games:portal', loader), [{ name: 'Portal' }]);
  assert.deepEqual(await cache.pobierzLubWczytaj('games:portal', loader), [{ name: 'Portal' }]);
  assert.equal(calls, 1);
  now += 1001;
  await cache.pobierzLubWczytaj('games:portal', loader);
  assert.equal(calls, 2);
});

test('IGDB cache coalesces concurrent requests for the same title', async () => {
  const cache = utworzCacheIGDB();
  let calls = 0;
  let resolve;
  const loader = () => {
    calls++;
    return new Promise(r => { resolve = r; });
  };
  const first = cache.pobierzLubWczytaj('games:hades', loader);
  const second = cache.pobierzLubWczytaj('games:hades', loader);
  resolve([{ name: 'Hades' }]);
  assert.deepEqual(await Promise.all([first, second]), [[{ name: 'Hades' }], [{ name: 'Hades' }]]);
  assert.equal(calls, 1);
  assert.equal(cache.stats.joined, 1);
});

test('IGDB cache keeps negative results briefly and does not cache thrown errors', async () => {
  let now = 0;
  let calls = 0;
  const cache = utworzCacheIGDB({ negativeTtlMs: 100, now: () => now });
  const empty = async () => { calls++; return null; };
  assert.equal(await cache.pobierzLubWczytaj('games:missing', empty), null);
  assert.equal(await cache.pobierzLubWczytaj('games:missing', empty), null);
  assert.equal(calls, 1);
  now = 101;
  await cache.pobierzLubWczytaj('games:missing', empty);
  assert.equal(calls, 2);

  let failures = 0;
  const broken = async () => { failures++; throw new Error('provider down'); };
  await assert.rejects(cache.pobierzLubWczytaj('games:broken', broken), /provider down/);
  await assert.rejects(cache.pobierzLubWczytaj('games:broken', broken), /provider down/);
  assert.equal(failures, 2);
});

test('IGDB cache enforces a bounded LRU entry count', async () => {
  const cache = utworzCacheIGDB({ maxEntries: 2 });
  await cache.pobierzLubWczytaj('games:a', async () => ['a']);
  await cache.pobierzLubWczytaj('games:b', async () => ['b']);
  await cache.pobierzLubWczytaj('games:a', async () => ['new-a']); // odśwież LRU
  await cache.pobierzLubWczytaj('games:c', async () => ['c']);
  assert.equal(cache.size(), 2);
  let calls = 0;
  await cache.pobierzLubWczytaj('games:b', async () => { calls++; return ['b']; });
  assert.equal(calls, 1);
});
