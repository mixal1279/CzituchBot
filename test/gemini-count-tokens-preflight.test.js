'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGeminiCountTokensBody } = require('../ai/gemini-count-tokens');

test('countTokens payload omits unsupported systemInstruction and counts its text', () => {
  const body = buildGeminiCountTokensBody({
    systemInstruction: { parts: [{ text: 'System instruction.' }] },
    contents: [{ role: 'user', parts: [{ text: 'User prompt.' }] }],
    generationConfig: { maxOutputTokens: 900, temperature: 0 },
  });

  assert.equal(Object.hasOwn(body, 'systemInstruction'), false);
  assert.equal(Object.hasOwn(body, 'generationConfig'), false);
  assert.deepEqual(body.contents, [
    { role: 'user', parts: [{ text: 'System instruction.' }] },
    { role: 'user', parts: [{ text: 'User prompt.' }] },
  ]);
});

test('countTokens payload keeps existing contents when no system instruction is supplied', () => {
  const contents = [{ role: 'user', parts: [{ text: 'Only prompt.' }] }];
  const body = buildGeminiCountTokensBody({ contents });
  assert.deepEqual(body.contents, contents);
});
