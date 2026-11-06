'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { utworzKolejkeAI } = require('../ai/concurrency');

function bramka() {
  let otworz;
  const promise = new Promise(resolve => { otworz = resolve; });
  return { promise, otworz };
}

test('AI queue never exceeds concurrency limit when queued tasks are handed off', async () => {
  const kolejka = utworzKolejkeAI({ maxConcurrent: 2, maxQueued: 2 });
  const bramki = [bramka(), bramka(), bramka(), bramka()];
  let aktywne = 0;
  let maksimum = 0;

  const zadanie = index => kolejka.wykonaj(async () => {
    aktywne++;
    maksimum = Math.max(maksimum, aktywne);
    await bramki[index].promise;
    aktywne--;
    return index;
  });

  const p1 = zadanie(0);
  const p2 = zadanie(1);
  const p3 = zadanie(2);
  const p4 = zadanie(3);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(kolejka.stan(), {
    aktywne: 2,
    oczekujace: 2,
    limit: 2,
    kolejkaLimit: 2,
  });

  await assert.rejects(
    kolejka.wykonaj(async () => 'nie powinno się uruchomić'),
    error => error.code === 'AI_QUEUE_FULL',
  );

  bramki[0].otworz();
  assert.equal(await p1, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(kolejka.stan().aktywne, 2);
  assert.equal(kolejka.stan().oczekujace, 1);

  bramki[1].otworz();
  bramki[2].otworz();
  bramki[3].otworz();
  assert.deepEqual(await Promise.all([p2, p3, p4]), [1, 2, 3]);
  assert.equal(maksimum, 2);
  assert.equal(kolejka.stan().aktywne, 0);
  assert.equal(kolejka.stan().oczekujace, 0);
});

test('AI queue expires stale waiters and releases their queue capacity', async () => {
  const kolejka = utworzKolejkeAI({ maxConcurrent: 1, maxQueued: 1, maxWaitMs: 25 });
  const bramka = new Promise(resolve => { globalThis.__queueTestRelease = resolve; });
  const aktywne = kolejka.wykonaj(async () => bramka);
  await new Promise(resolve => setImmediate(resolve));

  await assert.rejects(
    kolejka.wykonaj(async () => 'nie powinno się uruchomić'),
    error => error.code === 'AI_QUEUE_TIMEOUT',
  );
  assert.equal(kolejka.stan().aktywne, 1);
  assert.equal(kolejka.stan().oczekujace, 0);

  globalThis.__queueTestRelease();
  delete globalThis.__queueTestRelease;
  await aktywne;
  assert.equal(await kolejka.wykonaj(async () => 'ok'), 'ok');
  assert.equal(kolejka.stan().aktywne, 0);
});

test('AI queue releases its slot after task failure and after beforeStart failure', async () => {
  const kolejka = utworzKolejkeAI({ maxConcurrent: 1, maxQueued: 1 });
  await assert.rejects(kolejka.wykonaj(async () => { throw new Error('task failure'); }), /task failure/);
  assert.equal(kolejka.stan().aktywne, 0);

  const kolejkaZPrzygotowaniem = utworzKolejkeAI({
    maxConcurrent: 1,
    beforeStart: async () => { throw new Error('startup failure'); },
  });
  await assert.rejects(kolejkaZPrzygotowaniem.wykonaj(async () => true), /startup failure/);
  assert.equal(kolejkaZPrzygotowaniem.stan().aktywne, 0);
});

test('AI queue validates its limits and task input', async () => {
  assert.throws(() => utworzKolejkeAI({ maxConcurrent: 0 }), RangeError);
  assert.throws(() => utworzKolejkeAI({ maxQueued: -1 }), RangeError);
  assert.throws(() => utworzKolejkeAI({ maxWaitMs: 0 }), RangeError);
  const kolejka = utworzKolejkeAI();
  await assert.rejects(kolejka.wykonaj(null), TypeError);
});
