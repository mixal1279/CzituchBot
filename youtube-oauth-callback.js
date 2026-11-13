'use strict';

const http = require('http');
const crypto = require('crypto');

function stanyZgodne(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const buforA = Buffer.from(a);
  const buforB = Buffer.from(b);
  return buforA.length === buforB.length && crypto.timingSafeEqual(buforA, buforB);
}

function oczekujNaKodOAuth({
  state,
  port = 3000,
  host = 'localhost',
  timeoutMs = 5 * 60 * 1000,
  onListen,
  onServer,
} = {}) {
  if (typeof state !== 'string' || state.length < 32) {
    return Promise.reject(new TypeError('Nieprawidłowy stan OAuth.'));
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(new TypeError('Nieprawidłowy port callbacku OAuth.'));
  }
  if (typeof host !== 'string' || !host.trim()) {
    return Promise.reject(new TypeError('Nieprawidłowy adres nasłuchiwania OAuth.'));
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    return Promise.reject(new TypeError('Nieprawidłowy timeout callbacku OAuth.'));
  }

  return new Promise((resolve, reject) => {
    let zakonczono = false;
    let timer = null;

    const server = http.createServer((req, res) => {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Nieprawidłowe żądanie.');
        return;
      }

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Nie znaleziono.');
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Dozwolona jest wyłącznie metoda GET.');
        return;
      }

      const callbackState = url.searchParams.get('state');
      if (!stanyZgodne(callbackState, state)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Nieprawidłowy parametr state. Spróbuj ponownie.');
        return;
      }

      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Autoryzacja Google została anulowana lub odrzucona.');
        zakoncz(new Error('Google OAuth zwrócił błąd; szczegóły odpowiedzi pominięto.'));
        return;
      }

      const code = url.searchParams.get('code');
      if (typeof code !== 'string' || !code.trim() || code.length > 4096) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Brak lub nieprawidłowy kod autoryzacji.');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<h2>✅ Zalogowano! Możesz zamknąć tę kartę i wrócić do terminala.</h2>');
      zakoncz(null, code);
    });

    function zakoncz(error, code) {
      if (zakonczono) return;
      zakonczono = true;
      if (timer) clearTimeout(timer);
      if (server.listening) server.close();
      if (error) reject(error);
      else resolve(code);
    }

    server.on('error', error => zakoncz(error));
    if (typeof onServer === 'function') onServer(server);
    server.listen(port, host, () => {
      if (typeof onListen === 'function') onListen(server.address());
    });

    timer = setTimeout(() => {
      zakoncz(new Error('Przekroczono czas oczekiwania na callback YouTube OAuth.'));
    }, timeoutMs);
    timer.unref?.();
  });
}

module.exports = { oczekujNaKodOAuth };
