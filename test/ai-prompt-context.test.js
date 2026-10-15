'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBoundedEvidencePrompt } = require('../ai/prompt-context');

test('long evidence context keeps the actual question at the end of the generator prompt', () => {
  const question = 'W grze Portal 2: Dlaczego Wheatley przejął kontrolę nad GLaDOS?';
  const context = 'DANE REFERENCYJNE\n' + 'evidence block '.repeat(1200) + '\n---\nPytanie użytkownika: ' + question;
  const prompt = buildBoundedEvidencePrompt(context, question, 10000);
  assert.ok(prompt.length <= 10000);
  assert.ok(prompt.endsWith('Pytanie użytkownika: ' + question));
  assert.ok(prompt.includes('evidence block'));
});

test('plain questions and short contexts remain usable without duplication', () => {
  assert.equal(buildBoundedEvidencePrompt('Jak pokonać smoka?', 'Jak pokonać smoka?'), 'Jak pokonać smoka?');
  const prompt = buildBoundedEvidencePrompt('Dane o Skyrim', 'Jak pokonać smoka?');
  assert.ok(prompt.endsWith('Pytanie użytkownika: Jak pokonać smoka?'));
});

test('question survives even when evidence exceeds the prompt character budget', () => {
  const question = 'W grze Elden Ring: Gdzie znaleźć Wielki Miecz?';
  const context = 'x'.repeat(5000) + '\n---\nPytanie użytkownika: ' + question;
  const prompt = buildBoundedEvidencePrompt(context, question, 120);
  assert.ok(prompt.length <= 120);
  assert.ok(prompt.endsWith('Pytanie użytkownika: ' + question));
});
