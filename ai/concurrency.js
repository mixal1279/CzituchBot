'use strict';

function utworzKolejkeAI({ maxConcurrent = 3, maxQueued = 20, beforeStart = null } = {}) {
  const limit = Number(maxConcurrent);
  const kolejkaLimit = Number(maxQueued);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('maxConcurrent musi być dodatnią liczbą całkowitą');
  if (!Number.isSafeInteger(kolejkaLimit) || kolejkaLimit < 0) throw new RangeError('maxQueued musi być nieujemną liczbą całkowitą');
  if (beforeStart !== null && typeof beforeStart !== 'function') throw new TypeError('beforeStart musi być funkcją');

  let aktywne = 0;
  const oczekujace = [];

  async function wykonaj(zadanie) {
    if (typeof zadanie !== 'function') throw new TypeError('zadanie musi być funkcją');
    if (beforeStart) await beforeStart();

    if (aktywne < limit) {
      aktywne++;
    } else {
      if (oczekujace.length >= kolejkaLimit) {
        const blad = new Error('AI queue full');
        blad.code = 'AI_QUEUE_FULL';
        throw blad;
      }
      // Slot pozostaje zajęty. Zakończone zadanie przekazuje go bezpośrednio
      // następnemu oczekującemu, bez chwilowego zmniejszania licznika.
      await new Promise(resolve => oczekujace.push(resolve));
    }

    try {
      return await zadanie();
    } finally {
      const nastepne = oczekujace.shift();
      if (nastepne) nastepne();
      else aktywne--;
    }
  }

  function stan() {
    return { aktywne, oczekujace: oczekujace.length, limit, kolejkaLimit };
  }

  return { wykonaj, stan };
}

module.exports = { utworzKolejkeAI };
