'use strict';

const crypto = require('node:crypto');

function wylosujBit(randomInt = crypto.randomInt) {
  if (typeof randomInt !== 'function') throw new TypeError('randomInt musi być funkcją');
  const wynik = randomInt(0, 2);
  if (!Number.isInteger(wynik) || wynik < 0 || wynik > 1) {
    throw new RangeError('Generator zwrócił wartość spoza zakresu bitu');
  }
  return wynik;
}

module.exports = { wylosujBit };
