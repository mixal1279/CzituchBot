'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFirestoreState, encryptSecret, decryptSecret, encryptionKeyFromEnv } = require('../storage/firestore-state');
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

function createMockFirestore() {
  const docs = new Map();
  return {
    docs,
    collection(name) {
      return {
        doc(id) {
          const key = name + '/' + id;
          return {
            async get() {
              return { exists: docs.has(key), data: () => docs.get(key) };
            },
            async set(value) { docs.set(key, value); },
          };
        },
      };
    },
  };
}

test('OAuth token payload is encrypted and round-trips with the same key', () => {
  const key = Buffer.alloc(32, 7);
  const token = { access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600 };
  const encrypted = encryptSecret(token, key);
  assert.equal(JSON.stringify(encrypted).includes('access-secret'), false);
  assert.deepEqual(decryptSecret(encrypted, key), token);
  assert.throws(() => decryptSecret(encrypted, null), /OAUTH_TOKEN_ENCRYPTION_KEY/);
});

test('Firestore state stores OAuth tokens encrypted and reads them back', async () => {
  const db = createMockFirestore();
  const state = createFirestoreState(db, { encryptionKey: TEST_KEY, logger: { info() {}, warn() {} } });
  const token = { access_token: 'access-secret', refresh_token: 'refresh-secret' };
  await state.writeToken('twitch_test', token);
  assert.deepEqual(await state.readToken('twitch_test'), token);
  const document = db.docs.get('bot_runtime_state/oauth__twitch_test');
  assert.equal(JSON.stringify(document).includes('access-secret'), false);
});

test('weak or malformed encryption keys are rejected', () => {
  assert.equal(encryptionKeyFromEnv(TEST_KEY).length, 32);
  assert.throws(() => encryptionKeyFromEnv('short-secret'), /musi być kluczem 32-bajtowym/);
  assert.throws(() => createFirestoreState(createMockFirestore(), { encryptionKey: 'short-secret' }), /OAUTH_TOKEN_ENCRYPTION_KEY/);
});

test('Firestore token wins on mismatch while local backup is preserved', async () => {
  const db = createMockFirestore();
  const state = createFirestoreState(db, { encryptionKey: TEST_KEY, logger: { info() {}, warn() {} } });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'czituch-token-'));
  const file = path.join(dir, 'token.json');
  const current = { access_token: 'current', refresh_token: 'current-refresh' };
  const stale = { access_token: 'stale', refresh_token: 'stale-refresh' };
  await state.writeToken('youtube', current);
  await fs.writeFile(file, JSON.stringify(stale), 'utf8');
  try {
    assert.deepEqual(await state.migrateTokenFile('youtube', file), current);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), stale);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Firestore write failure preserves legacy token file', async () => {
  const db = {
    collection() {
      return {
        doc() {
          return {
            async get() { return { exists: false, data: () => undefined }; },
            async set() { throw new Error('Firestore unavailable'); },
          };
        },
      };
    },
  };
  const state = createFirestoreState(db, { encryptionKey: TEST_KEY, logger: { info() {}, warn() {} } });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'czituch-token-'));
  const file = path.join(dir, 'token.json');
  const legacy = { access_token: 'legacy', refresh_token: 'legacy-refresh' };
  await fs.writeFile(file, JSON.stringify(legacy), 'utf8');
  try {
    await assert.rejects(state.migrateTokenFile('youtube', file), /Firestore unavailable/);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), legacy);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('empty Firestore placeholder does not discard legacy cache entries', async () => {
  const db = createMockFirestore();
  await db.collection('bot_runtime_state').doc('cache__daily_cache').set({ value: {}, updatedAt: 'test', schemaVersion: 1 });
  const state = createFirestoreState(db, { encryptionKey: TEST_KEY, logger: { info() {}, warn() {} } });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'czituch-state-'));
  const file = path.join(dir, 'daily-cache.json');
  const cache = { 'youtube:channel:user_2026-10-18': { value: 'assigned' } };
  await fs.writeFile(file, JSON.stringify(cache), 'utf8');
  try {
    assert.deepEqual(await state.loadCache('daily_cache', file), cache);
    assert.deepEqual((await db.collection('bot_runtime_state').doc('cache__daily_cache').get()).data().value, cache);
    await assert.rejects(fs.access(file));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('legacy cache is migrated and deleted only after Firestore verification', async () => {
  const db = createMockFirestore();
  const state = createFirestoreState(db, { encryptionKey: TEST_KEY, logger: { info() {}, warn() {} } });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'czituch-state-'));
  const file = path.join(dir, 'daily-cache.json');
  const cache = { 'youtube:channel:user_2026-10-18': { value: 'assigned' } };
  await fs.writeFile(file, JSON.stringify(cache), 'utf8');
  try {
    assert.deepEqual(await state.loadCache('daily_cache', file), cache);
    await assert.rejects(fs.access(file));
    assert.deepEqual(await state.loadCache('daily_cache', null), cache);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
