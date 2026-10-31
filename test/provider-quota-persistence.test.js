'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fallback = require('../ai/fallback');

test('provider quota cooldowns restore from and persist to the runtime state store', async () => {
  const records = new Map();
  const store = {
    async read(kind, id) { return records.get(kind + ':' + id) || null; },
    async write(kind, id, value) { records.set(kind + ':' + id, structuredClone(value)); },
    logger: { warn() {} },
  };

  fallback.configureProviderQuotaPersistence(null);
  fallback.resetProviderQuotaCooldowns();
  await fallback.configureProviderQuotaPersistence(store);
  const [key] = fallback.markProviderQuota('gemini:gemini-3.8-flash', 60_000);
  assert.equal(key, 'gemini:gemini-3.8-flash');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(records.get('ai_quota:provider_cooldowns')?.version, 1);

  fallback.resetProviderQuotaCooldowns();
  await fallback.configureProviderQuotaPersistence(store);
  assert.equal(fallback.isProviderQuotaBlocked('gemini:gemini-3.8-flash'), true);
  assert.equal(fallback.isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite'), false);
  fallback.configureProviderQuotaPersistence(null);
});

test('provider-wide quota scope blocks sibling models but endpoint scope stays isolated', () => {
  fallback.configureProviderQuotaPersistence(null);
  fallback.resetProviderQuotaCooldowns();
  assert.equal(fallback.shouldBlockProviderQuotaWide('groq:openai/gpt-oss-120b', 'Rate limit exceeded: 6000 TPM'), true);
  assert.equal(fallback.shouldBlockProviderQuotaWide('xkiro:qwen/model', { status: 429, code: 'free_tokens_exhausted' }), true);
  assert.equal(fallback.shouldBlockProviderQuotaWide('gemini:flash', { status: 429, message: 'model rate limit exceeded' }), false);
  assert.equal(fallback.shouldBlockProviderQuotaWide('gemini:flash', { status: 402, message: 'payment required' }), true);
  fallback.markProviderQuota('groq:openai/gpt-oss-120b', 60_000, { scope: 'provider' });
  assert.equal(fallback.isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), true);
  fallback.resetProviderQuotaCooldowns();
  fallback.markProviderQuota('groq:openai/gpt-oss-120b', 60_000);
  assert.equal(fallback.isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), false);
  fallback.resetProviderQuotaCooldowns();
});
