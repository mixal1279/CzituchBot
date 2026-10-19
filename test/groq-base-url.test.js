'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Groq = require('groq-sdk');
const { normalizujGroqBaseUrl } = require('../ai/provider-runtime');

const przypadki = [
  ['brak zmiennej', undefined],
  ['sam host', 'https://api.groq.com'],
  ['host z ukośnikiem', 'https://api.groq.com/'],
  ['pełna baza API', 'https://api.groq.com/openai/v1'],
  ['pełna baza API z ukośnikiem', 'https://api.groq.com/openai/v1/'],
];

for (const [nazwa, env] of przypadki) {
  test('Groq SDK: finalny URL jest poprawny — ' + nazwa, async () => {
    let przechwyconyUrl;

    const klient = new Groq({
      apiKey: 'test-key',
      baseURL: normalizujGroqBaseUrl(env),
      maxRetries: 0,
      fetch: async (url) => {
        przechwyconyUrl = String(url);
        return new Response(JSON.stringify({
          id: 'test-id',
          object: 'chat.completion',
          created: 1,
          model: 'openai/gpt-oss-20b',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await klient.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.equal(
      przechwyconyUrl,
      'https://api.groq.com/openai/v1/chat/completions',
    );
  });
}

test('normalizator usuwa końcowe /openai/v1 bez względu na wielkość liter', () => {
  assert.equal(
    normalizujGroqBaseUrl('https://api.groq.com/OPENAI/V1/'),
    'https://api.groq.com',
  );
});
