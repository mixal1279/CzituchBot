'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyFailure } = require('../ai/fallback');
const { sprawdzTwardeFaktyOdpowiedzi } = require('../ai/response');

test('fallback classifier has one empty_response detail classifier', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ai', 'fallback.js'), 'utf8');
  assert.equal((source.match(/\['empty_response',/g) || []).length, 1);
  assert.equal(classifyFailure('empty response'), 'empty_response');
});

test('Portal 2 lore guard receives the question context for Wheatley takeover claims', () => {
  const answer = 'Wheatley przejął kontrolę dzięki przyciskowi rozwiązania impasu.';
  const question = 'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?';

  const withQuestion = sprawdzTwardeFaktyOdpowiedzi(answer, '', question);
  assert.equal(withQuestion.ok, false);
  assert.ok(withQuestion.unsupported.some(item => /mechanizmu przejęcia kontroli/.test(item)));
  assert.ok(withQuestion.unsupported.some(item => /przycisk rozwiązania impasu/.test(item)));

  const withoutQuestion = sprawdzTwardeFaktyOdpowiedzi(answer, '', '');
  assert.equal(withoutQuestion.ok, true);
});
