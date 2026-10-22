'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizujWynikWalidatora } = require('../ai/validator');

function makeResult(claim, claimEn, answer) {
  const quote = 'Wheatley took control of the facility after the core transfer.';
  const evidence = [
    '[SOURCE 1]',
    'TYTUŁ: Test',
    'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
    quote,
    '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
  ].join('\n');
  return normalizujWynikWalidatora({
    valid: true,
    reason: 'ok',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence: 0.95,
    claims: [{
      claim,
      claim_en: claimEn,
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: quote,
      reason: 'ok',
    }],
  }, 'test-model', 'gemini', new Set(['SOURCE 1']), evidence, answer);
}

test('English validator claims cannot stand in for Polish answer-language claims', () => {
  const result = makeResult(
    'Wheatley took control of the facility after the core transfer.',
    'Wheatley took control of the facility after the core transfer.',
    'Wheatley przejął kontrolę nad obiektem po transferze rdzenia.'
  );
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.diagnostics.claimLanguageMismatchIndexes, [0]);
  assert.ok(result.diagnostics.localRejectReasons.includes('claims_language_mismatch'));
  assert.match(result.reason, /języku sprawdzanej odpowiedzi/);
});

test('a Polish claim with a verified English translation is language-aligned', () => {
  const result = makeResult(
    'Wheatley przejął kontrolę nad obiektem po transferze rdzenia.',
    'Wheatley took control of the facility after the core transfer.',
    'Wheatley przejął kontrolę nad obiektem po transferze rdzenia.'
  );
  assert.deepEqual(result.diagnostics.claimLanguageMismatchIndexes, []);
});


test('English answer with a Polish proper name is classified by the sentence language', () => {
  const result = makeResult(
    'Łódź jest trzecim co do wielkości miastem w Polsce.',
    'Łódź is the third-largest city in Poland.',
    'Łódź is the third-largest city in Poland.'
  );
  assert.deepEqual(result.diagnostics.claimLanguageMismatchIndexes, [0]);
});

test('Polish grammar takes precedence over English words in game titles', () => {
  const result = makeResult(
    'The Last of Us ukazało się w 2013 roku.',
    'The Last of Us was released in 2013.',
    'The Last of Us ukazało się w 2013 roku.'
  );
  assert.deepEqual(result.diagnostics.claimLanguageMismatchIndexes, []);
});

test('Polish homographs do not make a Polish claim look English', () => {
  const result = makeResult(
    'Wheatley to on, który przejął kontrolę nad obiektem.',
    'Wheatley took control of the facility.',
    'Wheatley to on, który przejął kontrolę nad obiektem.'
  );
  assert.deepEqual(result.diagnostics.claimLanguageMismatchIndexes, []);
});

test('validator system prompt documents the claim-language contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');
  assert.match(source, /claim.*tym samym języku co ODPOWIEDŹ DO SPRAWDZENIA/i);
  assert.match(source, /claim_en.*wiernym angielskim tłumaczeniem pola "claim"/i);
});
