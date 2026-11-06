'use strict';

function utworzKolejkeAI({ maxConcurrent = 3, maxQueued = 20, maxWaitMs = 15000, beforeStart = null } = {}) {
  const limit = Number(maxConcurrent);
  const kolejkaLimit = Number(maxQueued);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('maxConcurrent musi być dodatnią liczbą całkowitą');
  if (!Number.isSafeInteger(kolejkaLimit) || kolejkaLimit < 0) throw new RangeError('maxQueued musi być nieujemną liczbą całkowitą');
  const czasOczekiwania = Number(maxWaitMs);
  if (!Number.isSafeInteger(czasOczekiwania) || czasOczekiwania < 1) throw new RangeError('maxWaitMs musi być dodatnią liczbą całkowitą');
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
      await new Promise((resolve, reject) => {
        const wpis = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        const timer = setTimeout(() => {
          const index = oczekujace.indexOf(wpis);
          if (index < 0) return;
          oczekujace.splice(index, 1);
          const blad = new Error('AI queue wait timeout');
          blad.code = 'AI_QUEUE_TIMEOUT';
          reject(blad);
        }, czasOczekiwania);
        oczekujace.push(wpis);
      });
    }

    try {
      return await zadanie();
    } finally {
      const nastepne = oczekujace.shift();
      if (nastepne) nastepne.resolve();
      else aktywne--;
    }
  }

  function stan() {
    return { aktywne, oczekujace: oczekujace.length, limit, kolejkaLimit };
  }

  return { wykonaj, stan };
}

module.exports = { utworzKolejkeAI };
