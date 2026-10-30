'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGroqCompletion, normalizeGroqSdkBaseUrl, normalizujGroqBaseUrl, groqTpmRetryAfterMs, resetGroqTpmWindow } = require('../ai/provider-runtime');

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

test('headroom applies to payloads that use the legacy max_tokens field', async () => {
  // Zapytania podpisujące się jako max_tokens (np. przepisywanie zapytania do
  // wyszukiwarki na modelu gpt-oss-20b) nie dostawały zapasu na reasoning:
  // helper czytał wyłącznie max_completion_tokens i po cichu nic nie robił.
  // Model rozumujący zjadał cały budżet i zwracał pustą treść.
  const seen = {};
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-20b', max_tokens: 220, reasoning_effort: 'low' });
  assert.equal(seen.payload.max_tokens, 1100, 'headroom liczony od tego samego pola, które podał wywołujący');
  assert.equal(seen.payload.max_completion_tokens, undefined, 'nazwa pola nie jest zmieniana');
});

test('headroom pomija pole ustawione na null i liczy od drugiego z pary', async () => {
  const seen = {};
  await createGroqCompletion(fakeClient(seen), { model: 'openai/gpt-oss-20b', max_completion_tokens: null, max_tokens: 220, reasoning_effort: 'low' });
  assert.equal(seen.payload.max_tokens, 1100);
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
  assert.equal(normalizeGroqSdkBaseUrl('https://api.groq.com/openai/v1'), 'https://api.groq.com');
  assert.equal(normalizeGroqSdkBaseUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com');
  assert.equal(normalizeGroqSdkBaseUrl('https://api.groq.com'), 'https://api.groq.com');
  assert.equal(normalizeGroqSdkBaseUrl('https://gateway.example/openai/v1'), 'https://gateway.example');
});


test('Groq base URL normalizer strips the SDK-owned REST prefix', () => {
  assert.equal(normalizujGroqBaseUrl(undefined), 'https://api.groq.com');
  assert.equal(normalizujGroqBaseUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com');
  assert.equal(normalizujGroqBaseUrl('https://gateway.example/'), 'https://gateway.example');
});

test('Groq TPM guard reserves estimated tokens for pending requests', async () => {
  resetGroqTpmWindow();
  const previous = process.env.AI_GROQ_TPM_GUARD;
  delete process.env.AI_GROQ_TPM_GUARD;
  const payload = {
    model: 'openai/gpt-oss-20b',
    max_completion_tokens: 3000,
    messages: [{ role: 'user', content: 'x'.repeat(3000) }],
  };
  const pending = new Promise(() => {});
  createGroqCompletion({ chat: { completions: { create: () => pending } } }, payload);
  assert.ok(groqTpmRetryAfterMs('openai/gpt-oss-20b', 4000) > 0);
  resetGroqTpmWindow();
  if (previous === undefined) delete process.env.AI_GROQ_TPM_GUARD;
  else process.env.AI_GROQ_TPM_GUARD = previous;
});
