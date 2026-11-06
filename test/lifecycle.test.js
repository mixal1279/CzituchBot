'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { utworzLifecycle } = require('../lifecycle');

test('zamyka zasoby w odwrotnej kolejności i tylko raz', async () => {
  const zamkniete = [];
  const lifecycle = utworzLifecycle({ logger: { info() {}, warn() {} } });
  lifecycle.zarejestruj('pierwszy', async () => zamkniete.push('pierwszy'));
  lifecycle.zarejestruj('drugi', async () => zamkniete.push('drugi'));

  await Promise.all([
    lifecycle.zamknijWszystko('test'),
    lifecycle.zamknijWszystko('duplikat'),
  ]);

  assert.deepEqual(zamkniete, ['drugi', 'pierwszy']);
  assert.equal(lifecycle.czyZamykanie(), true);
  assert.equal(lifecycle.liczbaZasobow(), 0);
});

test('błąd zamykania jednego zasobu nie blokuje pozostałych', async () => {
  const zamkniete = [];
  const lifecycle = utworzLifecycle({ logger: { info() {}, warn() {} } });
  lifecycle.zarejestruj('sprawny', () => zamkniete.push('sprawny'));
  lifecycle.zarejestruj('wadliwy', () => { throw new Error('awaria testowa'); });

  await lifecycle.zamknijWszystko();

  assert.deepEqual(zamkniete, ['sprawny']);
});

test('zamyka WebSocket i zwalnia rejestrację po zdarzeniu close', async () => {
  class FikcyjnySocket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 1;
      this.zamkniety = false;
    }
    close() {
      this.zamkniety = true;
      this.readyState = 3;
      queueMicrotask(() => this.emit('close', 1001, Buffer.from('shutdown')));
    }
    terminate() {
      this.readyState = 3;
      this.emit('close', 1006, Buffer.from('forced'));
    }
  }

  const lifecycle = utworzLifecycle({ logger: { info() {}, warn() {} }, closeTimeoutMs: 100 });
  const socket = new FikcyjnySocket();
  lifecycle.zarejestrujWebSocket(socket, 'socket testowy');
  assert.equal(lifecycle.liczbaZasobow(), 1);

  await lifecycle.zamknijWszystko();

  assert.equal(socket.zamkniety, true);
  assert.equal(lifecycle.liczbaZasobow(), 0);
});

test('zamyka zasób zarejestrowany po rozpoczęciu shutdownu', async () => {
  let zamkniety = false;
  const lifecycle = utworzLifecycle({ logger: { info() {}, warn() {} } });
  await lifecycle.zamknijWszystko();
  lifecycle.zarejestruj('spóźniony', () => { zamkniety = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(zamkniety, true);
});

test('SIGTERM wykonuje cleanup przed zakończeniem procesu', async () => {
  const proc = new EventEmitter();
  proc.exitCode = undefined;
  const wyjscia = [];
  const kolejnosc = [];
  const lifecycle = utworzLifecycle({ logger: { info() {}, warn() {}, error() {} }, closeTimeoutMs: 100 });
  lifecycle.zarejestruj('zasób', async () => kolejnosc.push('cleanup'));
  lifecycle.zainstalujObslugeProcesu(proc, kod => wyjscia.push(kod));

  proc.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(kolejnosc, ['cleanup']);
  assert.deepEqual(wyjscia, [0]);
  assert.equal(proc.exitCode, 0);
});
