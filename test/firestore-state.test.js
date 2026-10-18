'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFirestoreState, encryptSecret, decryptSecret } = require('../storage/firestore-state');

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
  const key = 'test-encryption-key-not-for-production';
  const token = { access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600 };
  const encrypted = encryptSecret(token, require('node:crypto').createHash('sha256').update(key).digest());
  assert.equal(JSON.stringify(encrypted).includes('access-secret'), false);
  assert.deepEqual(decryptSecret(encrypted, require('node:crypto').createHash('sha256').update(key).digest()), token);
  assert.throws(() => decryptSecret(encrypted, null), /OAUTH_TOKEN_ENCRYPTION_KEY/);
});

test('Firestore state stores OAuth tokens encrypted and reads them back', async () => {
  const db = createMockFirestore();
  const state = createFirestoreState(db, { encryptionKey: 'test-encryption-key-not-for-production', logger: { info() {}, warn() {} } });
  const token = { access_token: 'access-secret', refresh_token: 'refresh-secret' };
  await state.writeToken('twitch_test', token);
  assert.deepEqual(await state.readToken('twitch_test'), token);
  const document = db.docs.get('bot_runtime_state/oauth__twitch_test');
  assert.equal(JSON.stringify(document).includes('access-secret'), false);
});

test('legacy cache is migrated and deleted only after Firestore verification', async () => {
  const db = createMockFirestore();
  const state = createFirestoreState(db, { encryptionKey: 'test-encryption-key-not-for-production', logger: { info() {}, warn() {} } });
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
