'use strict';

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_COLLECTION = 'bot_runtime_state';

function encryptionKeyFromEnv(value = process.env.OAUTH_TOKEN_ENCRYPTION_KEY) {
  if (!value) return null;
  // Accept a 32-byte hex/base64 key, otherwise derive a stable 32-byte key.
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) return decoded;
  return crypto.createHash('sha256').update(value, 'utf8').digest();
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

  if (!db) {
    return {
      enabled: false,
      async read() { return null; },
      async write() { throw new Error('Firestore jest wyłączony.'); },
      async readToken() { return null; },
      async writeToken() { throw new Error('Firestore jest wyłączony.'); },
      async loadCache(_cacheName, legacyFile = null) {
        try {
          const parsed = JSON.parse(await fs.promises.readFile(legacyFile, 'utf8'));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) { return {}; }
      },
      async saveCache() {},
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
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      if (legacyFile) await removeLegacyAfterVerified(legacyFile, stored, cacheName);
      return stored;
    }

    let legacy = {};
    if (legacyFile) {
      try {
        const raw = await fs.promises.readFile(legacyFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) legacy = parsed;
      } catch (error) {
        if (error.code !== 'ENOENT') logger.warn?.('[Firestore state] Nie udało się odczytać starego cache:', error.message);
      }
    }

    // Zapisujemy nawet pusty obiekt, aby po pierwszym uruchomieniu źródłem prawdy był Firestore.
    await write('cache', cacheName, legacy);
    if (legacyFile) await removeLegacyAfterVerified(legacyFile, legacy, cacheName);
    return legacy;
  }

  async function removeLegacyAfterVerified(file, expected, cacheName) {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return;
      const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (JSON.stringify(parsed) !== JSON.stringify(expected)) return;
      const check = await read('cache', cacheName);
      // Cache document IDs can be logical names rather than file names. Only remove
      // when the caller has already loaded the stored value and confirmed equality.
      if (check && JSON.stringify(check) === JSON.stringify(expected)) {
        await fs.promises.unlink(file);
        logger.info?.('[Firestore state] Stary plik cache przeniesiony do Firestore:', file);
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

    // If the local token differs, treat it as the latest state and migrate it
    // before deleting anything. This avoids silently discarding a rotated refresh token.
    if (legacy && JSON.stringify(legacy) !== JSON.stringify(stored)) {
      await writeToken(provider, legacy);
      const verified = await readToken(provider);
      if (JSON.stringify(verified) !== JSON.stringify(legacy)) {
        throw new Error('Weryfikacja migracji tokenu OAuth nie powiodła się.');
      }
      await fs.promises.unlink(file);
      logger.info?.('[Firestore state] Token OAuth przeniesiony do Firestore:', provider);
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
