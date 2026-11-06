'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  czyWymagaKlasyfikacjiSemantycznej,
  parsujKlasyfikacje,
  klasyfikujSemantycznie,
} = require('../ai/semantic-classifier');

test('fallback działa tylko dla niejednoznacznego tematu pytania faktograficznego', () => {
  assert.equal(czyWymagaKlasyfikacjiSemantycznej({ intent: 'web_fact', topic_type: 'general', confidence: 0.65 }), true);
  assert.equal(czyWymagaKlasyfikacjiSemantycznej({ intent: 'conversation', topic_type: 'general', confidence: 0.65 }), false);
  assert.equal(czyWymagaKlasyfikacjiSemantycznej({ intent: 'web_fact', topic_type: 'technology', confidence: 0.65 }), false);
  assert.equal(czyWymagaKlasyfikacjiSemantycznej({ intent: 'web_fact', topic_type: 'general', confidence: 0.9 }), false);
});

test('parser akceptuje wyłącznie dozwolone typy klasyfikacji', () => {
  assert.deepEqual(parsujKlasyfikacje('{"topic_type":"technology","question_type":"comparison"}'), {
    topic_type: 'technology',
    question_type: 'comparison',
  });
  assert.equal(parsujKlasyfikacje('{"topic_type":"unknown","question_type":"fact"}'), null);
  assert.equal(parsujKlasyfikacje('{"topic_type":"game","question_type":"execute_code"}'), null);
  assert.equal(parsujKlasyfikacje('niepoprawny json'), null);
  assert.equal(parsujKlasyfikacje('{"topic_type":"game","question_type":"lore","intent":"admin"}').intent, undefined);
});

test('klasyfikator przekazuje pytanie jako dane i parsuje odpowiedź modelu', async () => {
  let request;
  const wynik = await klasyfikujSemantycznie('Czym różni się OLED od QLED?', {
    klient: {},
    model: 'openai/gpt-oss-20b',
    timeoutMs: 500,
    utworzCompletion: async (_klient, payload, options) => {
      request = { payload, options };
      return { choices: [{ message: { content: '{"topic_type":"technology","question_type":"comparison"}' } }] };
    },
  });
  assert.deepEqual(wynik, { topic_type: 'technology', question_type: 'comparison' });
  assert.equal(request.payload.max_tokens, 220);
  assert.equal(request.payload.temperature, 0);
  assert.equal(request.payload.response_format.type, 'json_object');
  assert.equal(request.payload.messages[1].content, 'Czym różni się OLED od QLED?');
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('brak klienta lub błąd modelu bezpiecznie wraca do klasyfikacji deterministycznej', async () => {
  assert.equal(await klasyfikujSemantycznie('pytanie', {}), null);
  const wynik = await klasyfikujSemantycznie('pytanie', {
    klient: {},
    model: 'test',
    utworzCompletion: async () => { throw new Error('provider unavailable'); },
  });
  assert.equal(wynik, null);
});
