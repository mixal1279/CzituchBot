'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGroqCompletion, normalizujGroqBaseUrl, groqTpmRetryAfterMs, resetGroqTpmWindow } = require('../ai/provider-runtime');

function fakeClient(sink) {
  return { chat: { completions: { create(payload) { sink.payload = payload; return Promise.resolve({}); } } } };
}

test('gpt-oss models get reasoning headroom on top of the answer budget', async () => {
  const seen = {};
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-120b', max_completion_tokens: 300, reasoning_effort: 'medium' });
  assert.equal(seen.payload.max_completion_tokens, 1800);
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-20b', max_completion_tokens: 100, reasoning_effort: 'low' });
  assert.equal(seen.payload.max_completion_tokens, 1100, 'answer budget is floored at 300 before headroom');
});

test('headroom is applied once per payload object and keeps object identity', async () => {
  const seen = {};
  const payload = { model: 'openai/gpt-oss-120b', max_completion_tokens: 300, reasoning_effort: 'medium' };
  await createGroqCompletion(fakeClient(seen), payload);
  await createGroqCompletion(fakeClient(seen), payload);
  assert.equal(seen.payload, payload);
  assert.equal(payload.max_completion_tokens, 1800);
});

test('headroom never lowers an explicit large budget and is capped otherwise', async () => {
  const seen = {};
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-120b', max_completion_tokens: 6000, reasoning_effort: 'medium' });
  assert.equal(seen.payload.max_completion_tokens, 6000);
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-120b', max_completion_tokens: 3000, reasoning_effort: 'medium' });
  assert.equal(seen.payload.max_completion_tokens, 4000);
});

test('other models and payloads without reasoning_effort are untouched', async () => {
  const seen = {};
  await createGroqCompletion(fakeClient(seen), { model: 'llama-3.3-70b-versatile', max_completion_tokens: 300, reasoning_effort: 'low' });
  assert.equal(seen.payload.max_completion_tokens, 300);
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-120b', max_completion_tokens: 300 });
  assert.equal(seen.payload.max_completion_tokens, 300);
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-120b', reasoning_effort: 'medium' });
  assert.equal(seen.payload.max_completion_tokens, undefined);
});


test('Groq SDK base URL strips the endpoint prefix already included by the SDK', () => {
  assert.equal(normalizujGroqBaseUrl('https://api.groq.com/openai/v1'), 'https://api.groq.com');
  assert.equal(normalizeGroqSdkBaseUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com');
  assert.equal(normalizeGroqSdkBaseUrl('https://api.groq.com'), 'https://api.groq.com');
  assert.equal(normalizeGroqSdkBaseUrl('https://gateway.example/openai/v1'), 'https://gateway.example');
});


test('missing Groq usage never resets TPM accounting to zero', async () => {
  const previousLimits = process.env.AI_GROQ_TPM_LIMITS;
  const previousGuard = process.env.AI_GROQ_TPM_GUARD;
  process.env.AI_GROQ_TPM_GUARD = '1';
  process.env.AI_GROQ_TPM_LIMITS = JSON.stringify({ 'openai/gpt-oss-20b': 8000 });
  resetGroqTpmWindow();
  try {
    const client = { chat: { completions: { create() { return Promise.resolve({ choices: [] }); } } } };
    await createGroqCompletion(client, {
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: 'x'.repeat(100) }],
      max_completion_tokens: 4500,
    });
    assert.ok(groqTpmRetryAfterMs('openai/gpt-oss-20b', 4500) > 0,
      'conservative estimated usage must remain accounted when response.usage is absent');
  } finally {
    resetGroqTpmWindow();
    if (previousLimits === undefined) delete process.env.AI_GROQ_TPM_LIMITS;
    else process.env.AI_GROQ_TPM_LIMITS = previousLimits;
    if (previousGuard === undefined) delete process.env.AI_GROQ_TPM_GUARD;
    else process.env.AI_GROQ_TPM_GUARD = previousGuard;
  }
});
