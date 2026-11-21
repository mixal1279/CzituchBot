'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { czyBezpiecznaKwotaEko } = require('../economy/validation');

test('akceptuje wyłącznie dodatnie bezpieczne liczby całkowite', () => {
  for (const kwota of [1, 25, 1000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(czyBezpiecznaKwotaEko(kwota), true, String(kwota));
  }
});

test('odrzuca zero, wartości ujemne, ułamki i liczby poza bezpiecznym zakresem', () => {
  for (const kwota of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '100', null, undefined]) {
    assert.equal(czyBezpiecznaKwotaEko(kwota), false, String(kwota));
  }
});
