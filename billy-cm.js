'use strict';

const BILLY_CM_PREFIX = 'twitch:billybulka:';

function buildBillyCmResponse({ cache, streamKey, nick, message, rng = Math.random, legacyCache = null }) {
  if (!cache || typeof cache !== 'object') throw new TypeError('cache must be an object');
  if (typeof message !== 'string' || !/^!cm(?:\\s+@?[a-zA-Z0-9_]+)?\\s*$/i.test(message.trim())) return null;

  const parts = message.trim().split(/\\s+/);
  const targetDisplay = (parts[1] || nick || '').replace(/^@/, '').trim();
  const targetKey = targetDisplay.toLocaleLowerCase('pl-PL');
  if (!targetDisplay || !targetKey) {
    return { response: 'Użycie: !cm [@nick]', changed: false };
  }

  const normalizedStreamKey = streamKey === null || streamKey === undefined || streamKey === ''
    ? null
    : String(streamKey);
  if (!normalizedStreamKey) {
    return {
      response: `@${nick} nie mam jeszcze identyfikatora tego streama — spróbuj za chwilę.`,
      changed: false,
    };
  }

  const currentPrefix = `${BILLY_CM_PREFIX}${normalizedStreamKey}:`;
  let changed = false;
  // Migruj przypisania ze starego cache plikowego, ale wyłącznie dla tego samego streamu.
  if (legacyCache && String(legacyCache.streamKey || '') === normalizedStreamKey && legacyCache.users && typeof legacyCache.users === 'object') {
    for (const [user, value] of Object.entries(legacyCache.users)) {
      const key = `${currentPrefix}${String(user).toLocaleLowerCase('pl-PL')}`;
      if (Number.isInteger(value) && value >= 1 && value <= 30 && !Number.isInteger(cache[key])) { cache[key] = value; changed = true; }
    }
  }

  for (const key of Object.keys(cache)) {
    if (key.startsWith(BILLY_CM_PREFIX) && !key.startsWith(currentPrefix)) {
      delete cache[key];
      changed = true;
    }
  }

  const cacheKey = `${currentPrefix}${targetKey}`;
  let value = cache[cacheKey];
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    value = Math.floor(Math.max(0, Math.min(0.999999999999, Number(rng()) || 0)) * 30) + 1;
    cache[cacheKey] = value;
    changed = true;
  }

  const comments = [
    { max: 5, text: 'lokalny wróbel przeprowadził się tam na stałe 🐦' },
    { max: 12, text: 'gmina rozważa tam budowę mostu turystycznego 🌉' },
    { max: 20, text: 'IKEA już projektuje do tego osobną szafkę 🗄️' },
    { max: 30, text: 'Google Maps dodało to jako punkt orientacyjny 🗺️' },
  ];
  const comment = comments.find(item => value <= item.max)?.text || '';
  return {
    response: `@${targetDisplay} ma ${value} cm 📏 – ${comment}`,
    changed,
    value,
    target: targetDisplay,
    streamKey: normalizedStreamKey,
  };
}

module.exports = { buildBillyCmResponse };
