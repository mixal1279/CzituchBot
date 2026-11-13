'use strict';

const crypto = require('node:crypto');

function wylosujLiczbe(min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) {
    throw new RangeError('Nieprawidłowy zakres losowania');
  }
  return crypto.randomInt(min, max);
}

function wylosujIndeks(dlugosc) {
  if (!Number.isSafeInteger(dlugosc) || dlugosc <= 0) {
    throw new RangeError('Długość tablicy musi być dodatnią liczbą całkowitą');
  }
  return wylosujLiczbe(0, dlugosc);
}

function wylosujBit(randomInt = crypto.randomInt) {
  if (typeof randomInt !== 'function') throw new TypeError('randomInt musi być funkcją');
  const wynik = randomInt(0, 2);
  if (!Number.isInteger(wynik) || wynik < 0 || wynik > 1) {
    throw new RangeError('Generator zwrócił wartość spoza zakresu bitu');
  }
  return wynik;
}

module.exports = { wylosujLiczbe, wylosujIndeks, wylosujBit };
