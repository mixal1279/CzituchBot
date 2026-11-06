'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { oczekujNaKodOAuth } = require('../youtube-oauth-callback');

function zapytanie(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('błędny state i ścieżka nie kończą oczekiwania na prawidłowy callback', async () => {
  let adres;
  let serwer;
  const oczekiwanie = oczekujNaKodOAuth({
    state: 'a'.repeat(64),
    port: 0,
    host: '127.0.0.1',
    timeoutMs: 5000,
    onListen: value => { adres = value; },
    onServer: value => { serwer = value; },
  });

  while (!adres) await new Promise(resolve => setImmediate(resolve));
  assert.ok(serwer instanceof http.Server);
  assert.equal(serwer.listening, true);
  const zlaSciezka = await zapytanie(adres.port, '/inna');
  assert.equal(zlaSciezka.status, 404);

  const zlyState = await zapytanie(adres.port, '/callback?state=niepoprawny&code=x');
  assert.equal(zlyState.status, 400);

  const poprawny = await zapytanie(adres.port, `/callback?state=${'a'.repeat(64)}&code=abc123`);
  assert.equal(poprawny.status, 200);
  assert.match(poprawny.headers['cache-control'], /no-store/);
  assert.equal(await oczekiwanie, 'abc123');
});

test('odrzuca metody inne niż GET bez zamykania serwera', async () => {
  let adres;
  const oczekiwanie = oczekujNaKodOAuth({
    state: 'b'.repeat(64),
    port: 0,
    host: '127.0.0.1',
    timeoutMs: 5000,
    onListen: value => { adres = value; },
  });

  while (!adres) await new Promise(resolve => setImmediate(resolve));
  const odpowiedz = await zapytanie(adres.port, `/callback?state=${'b'.repeat(64)}&code=abc`, 'POST');
  assert.equal(odpowiedz.status, 405);

  const poprawny = await zapytanie(adres.port, `/callback?state=${'b'.repeat(64)}&code=xyz`);
  assert.equal(poprawny.status, 200);
  assert.equal(await oczekiwanie, 'xyz');
});

test('timeout kończy oczekiwanie i zamyka serwer', async () => {
  await assert.rejects(
    oczekujNaKodOAuth({
      state: 'c'.repeat(64),
      port: 0,
      host: '127.0.0.1',
      timeoutMs: 1000,
    }),
    /Przekroczono czas oczekiwania/,
  );
});
