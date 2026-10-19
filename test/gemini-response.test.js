'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGeminiGenerationResponse, buildGeminiGenerateContentUrl } = require('../ai/gemini-response');

test('Gemini generation: brak kandydatów zachowuje promptFeedback i safetyRatings', () => {
  const result = parseGeminiGenerationResponse({
    promptFeedback: {
      blockReason: 'SAFETY',
      safetyRatings: [{
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        blocked: true,
        probability: 'HIGH',
      }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blockReason, 'SAFETY');
  assert.match(result.reason, /promptFeedback\.blockReason=SAFETY/);
  assert.match(result.reason, /HARM_CATEGORY_DANGEROUS_CONTENT/);
  assert.equal(result.safetyRatings[0].blocked, true);
});

test('Gemini generation: brak kandydatów bez promptFeedback jest odróżniony od blokady', () => {
  const result = parseGeminiGenerationResponse({ candidates: [] }, 'Gemini Lite');

  assert.equal(result.ok, false);
  assert.match(result.reason, /Gemini Lite: brak kandydatów/);
  assert.match(result.reason, /brak promptFeedback\.blockReason/);
  assert.equal(Object.hasOwn(result, 'blockReason'), false);
});

test('Gemini generation: kandydat z blokadą SAFETY nie jest używany jako odpowiedź', () => {
  const result = parseGeminiGenerationResponse({
    candidates: [{
      finishReason: 'SAFETY',
      finishMessage: 'Candidate blocked by safety filters',
      content: { parts: [{ text: 'partial text must not be used' }] },
      safetyRatings: [{
        category: 'HARM_CATEGORY_HARASSMENT',
        blocked: true,
        probability: 'HIGH',
      }],
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.finishReason, 'SAFETY');
  assert.equal(result.finishMessage, 'Candidate blocked by safety filters');
  assert.match(result.reason, /finishReason=SAFETY/);
  assert.equal(result.safetyRatings[0].blocked, true);
});

test('Gemini generation: pusty kandydat zachowuje finishReason OTHER i finishMessage', () => {
  const result = parseGeminiGenerationResponse({
    candidates: [{
      finishReason: 'OTHER',
      finishMessage: 'Model stopped without text output',
      content: { parts: [] },
    }],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /finishReason=OTHER/);
  assert.match(result.reason, /finishMessage=Model stopped without text output/);
  assert.equal(result.finishReason, 'OTHER');
});

test('Gemini generation: MAX_TOKENS zachowuje tekst i oznacza odpowiedź jako uciętą', () => {
  const result = parseGeminiGenerationResponse({
    candidates: [{
      finishReason: 'MAX_TOKENS',
      content: { parts: [{ text: 'partial but usable answer' }] },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'partial but usable answer');
  assert.equal(result.truncated, true);
  assert.equal(result.finishReason, 'MAX_TOKENS');
});

test('Gemini generation: CONTINUATION nie jest używane jako kompletna odpowiedź', () => {
  const result = parseGeminiGenerationResponse({
    candidates: [{
      finishReason: 'CONTINUATION',
      finishMessage: 'Response can be continued with the continuation token',
      content: { parts: [{ text: '{"claims": [' }] },
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.finishReason, 'CONTINUATION');
  assert.match(result.reason, /finishReason=CONTINUATION/);
});

test('Gemini generation: STOP zwraca kompletną odpowiedź tekstową', () => {
  const result = parseGeminiGenerationResponse({
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text: '  complete answer  ' }] },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'complete answer');
  assert.equal(result.truncated, false);
  assert.equal(result.finishReason, 'STOP');
});

test('Gemini generateContent URL follows the configured model ID', () => {
  assert.equal(
    buildGeminiGenerateContentUrl('gemini-3.8-flash'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
  );
  assert.equal(
    buildGeminiGenerateContentUrl('gemini-custom-test'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-custom-test:generateContent',
  );
  assert.throws(() => buildGeminiGenerateContentUrl(''), /Invalid Gemini model ID/);
  assert.throws(() => buildGeminiGenerateContentUrl('models/gemini-3.8-flash'), /Invalid Gemini model ID/);
});
