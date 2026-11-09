'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('regexy zachowują ograniczony czas wykonania na wejściach w granicach limitów aplikacji', { timeout: 8000 }, () => {
  const worker = path.join(__dirname, 'regex-stress-worker.js');
  const wynik = spawnSync(process.execPath, [worker], {
    encoding: 'utf8',
    timeout: 6000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });

  assert.equal(wynik.error?.code, 'ETIMEDOUT', false, 'test obciążeniowy przekroczył twardy limit czasu');
  assert.equal(wynik.status, 0, wynik.stderr || 'proces testowy zakończył się błędem');

  const pomiary = JSON.parse(wynik.stdout);
  assert.equal(pomiary.length, 12);
  for (const pomiar of pomiary) {
    assert.ok(Number.isFinite(pomiar.ms) && pomiar.ms < 1500,
      `${pomiar.nazwa} dla ${pomiar.dlugosc} znaków trwał ${pomiar.ms} ms`);
  }
});
