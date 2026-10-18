'use strict';

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_COLLECTION = 'bot_runtime_state';
const LEGACY_CACHE_FILES = {
  horoscopes: './horoskopy_cache.json',
  daily_bulka: './bulka_cache.json',
  daily_arbuz: './arbuz_cache.json',
  daily_ciastko: './ciastko_cache.json',
  stream_cm: './cm_stream_cache.json',
  tiktok_tracking: './tiktok_state.json',
  tavily_search: './tavily_cache.json',
};

function encryptionKeyFromEnv(value = process.env.OAUTH_TOKEN_ENCRYPTION_KEY) {
  if (!value) return null;
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  // openssl rand -base64 32 emits a 32-byte key in canonical 44-char Base64.
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32 && decoded.toString('base64') === value) return decoded;
  }
  throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY musi być kluczem 32-bajtowym Base64 lub 64 znaków hex.');
}

function encryptSecret(value, key) {
  if (!key) throw new Error('Brak OAUTH_TOKEN_ENCRYPTION_KEY — nie zapisuję tokenu OAuth w postaci jawnej.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptSecret(payload, key) {
  if (!payload || payload.algorithm !== 'aes-256-gcm' || payload.version !== 1) {
    throw new Error('Nieobsługiwany format zaszyfrowanego tokenu OAuth.');
  }
  if (!key) throw new Error('Brak OAUTH_TOKEN_ENCRYPTION_KEY — nie można odszyfrować tokenu OAuth.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function createFirestoreState(db, options = {}) {
  const logger = options.logger || console;
  const key = encryptionKeyFromEnv(options.encryptionKey);
  const collection = options.collection || DEFAULT_COLLECTION;

  if (db && !key) {
    throw new Error('Brak poprawnego OAUTH_TOKEN_ENCRYPTION_KEY. Ustaw klucz przed uruchomieniem magazynu Firestore.');
  }

  if (!db) {
    return {
      enabled: false,
      async read() { return null; },
      async write() { throw new Error('Firestore jest wyłączony.'); },
      async readToken() { return null; },
      async writeToken() { throw new Error('Firestore jest wyłączony.'); },
      async loadCache(cacheName, legacyFile = null) {
        const file = legacyFile || LEGACY_CACHE_FILES[cacheName];
        if (!file) return {};
        try {
          const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) { return {}; }
      },
      async saveCache(cacheName, value) {
        const file = LEGACY_CACHE_FILES[cacheName];
        if (!file) throw new Error('Firestore jest wyłączony i brak lokalnej ścieżki cache dla: ' + cacheName);
        await fs.promises.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
      },
    };
  }

  async function read(kind, id) {
    const snapshot = await db.collection(collection).doc(kind + '__' + id).get();
    if (!snapshot.exists) return null;
    return snapshot.data()?.value ?? null;
  }

  async function write(kind, id, value) {
    await db.collection(collection).doc(kind + '__' + id).set({
      value,
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    }, { merge: false });
  }

  async function readToken(provider) {
    const payload = await read('oauth', provider);
    if (!payload) return null;
    return decryptSecret(payload, key);
  }

  async function writeToken(provider, token) {
    await write('oauth', provider, encryptSecret(token, key));
  }

  async function loadCache(cacheName, legacyFile = null) {
    const stored = await read('cache', cacheName);
    let legacy = {};
    if (legacyFile) {
      try {
        const parsed = JSON.parse(await fs.promises.readFile(legacyFile, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) legacy = parsed;
      } catch (error) {
        if (error.code !== 'ENOENT') logger.warn?.('[Firestore state] Nie udało się odczytać starego cache:', error.message);
      }
    }

    const storedIsObject = stored && typeof stored === 'object' && !Array.isArray(stored);
    // Merge legacy entries missing from Firestore; Firestore wins on duplicate keys.
    const merged = storedIsObject ? { ...legacy, ...stored } : legacy;
    const needsWrite = !storedIsObject || JSON.stringify(merged) !== JSON.stringify(stored);
    if (needsWrite) {
      await write('cache', cacheName, merged);
      const verified = await read('cache', cacheName);
      if (!verified || JSON.stringify(verified) !== JSON.stringify(merged)) {
        throw new Error('Weryfikacja migracji cache nie powiodła się: ' + cacheName);
      }
    }
    if (legacyFile) await removeLegacyAfterVerified(legacyFile, merged, cacheName);
    return merged;
  }

  async function removeLegacyAfterVerified(file, expected, cacheName) {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return;
      const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
        logger.warn?.('[Firestore state] Stary plik cache różni się od scalonych danych; zachowuję go jako kopię zapasową:', file);
        return;
      }
      const check = await read('cache', cacheName);
      // Cache document IDs can be logical names rather than file names. Only remove
      // when the caller has already loaded the stored value and confirmed equality.
      if (check && JSON.stringify(check) === JSON.stringify(expected)) {
        await fs.promises.unlink(file);
        logger.info?.('[Firestore state] Stary plik cache przeniesiony do Firestore:', file);
      } else {
        logger.warn?.('[Firestore state] Nie usuwam starego pliku cache — dane w Firestore nie przeszły weryfikacji:', file);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') logger.warn?.('[Firestore state] Nie usunięto starego pliku cache:', error.message);
    }
  }

  async function saveCache(cacheName, value) {
    await write('cache', cacheName, value);
  }

  async function migrateTokenFile(provider, file) {
    const stored = await readToken(provider);
    let legacy = null;
    try {
      legacy = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (stored && legacy && JSON.stringify(legacy) !== JSON.stringify(stored)) {
      // Firestore is canonical once it can be decrypted. Keep the local file as a
      // backup, but do not prefer a possibly stale refresh token.
      logger.warn?.('[Firestore state] Token lokalny różni się od Firestore; używam Firestore, a plik zachowuję jako kopię zapasową:', provider);
      return stored;
    }

    if (legacy && !stored) {
      await writeToken(provider, legacy);
      const verified = await readToken(provider);
      if (JSON.stringify(verified) !== JSON.stringify(legacy)) {
        throw new Error('Weryfikacja migracji tokenu OAuth nie powiodła się.');
      }
      try {
        await fs.promises.unlink(file);
        logger.info?.('[Firestore state] Token OAuth przeniesiony do Firestore:', provider);
      } catch (error) {
        if (error.code !== 'ENOENT') logger.warn?.('[Firestore state] Token zapisany i zweryfikowany, ale nie usunięto starego pliku:', error.message);
      }
      return verified;
    }

    if (stored) {
      if (legacy) {
        try { await fs.promises.unlink(file); } catch (error) {
          if (error.code !== 'ENOENT') logger.warn?.('[Firestore state] Nie usunięto starego pliku tokenu:', error.message);
        }
      }
      return stored;
    }
    return null;
  }

  return {
    enabled: true,
    read,
    write,
    readToken,
    writeToken,
    loadCache,
    saveCache,
    migrateTokenFile,
  };
}

module.exports = {
  createFirestoreState,
  encryptionKeyFromEnv,
  encryptSecret,
  decryptSecret,
};
