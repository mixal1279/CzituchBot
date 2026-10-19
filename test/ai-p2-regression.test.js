'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyFailure } = require('../ai/fallback');
const { sprawdzTwardeFaktyOdpowiedzi } = require('../ai/response');
const { createAIRequestContext } = require('../ai/requestContext');

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
  assert.ok(withQuestion.unsupported.some(item => /przycisk rozwiązania impasu/.test(item)));

  const withoutQuestion = sprawdzTwardeFaktyOdpowiedzi(answer, '', '');
  assert.equal(withoutQuestion.ok, true);
});


test('deterministic response diagnostics separate Portal 2 lore from evidence-token checks', () => {
  const answer = 'Wheatley przejął kontrolę nad GLaDOS po transferze rdzenia do jej ciała.';
  const question = 'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?';
  const data = 'Portal 2. Wheatley przejął kontrolę nad GLaDOS po transferze rdzenia do jej ciała.';
  const result = sprawdzTwardeFaktyOdpowiedzi(answer, data, question);

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.hardTokenCheck.ok, true);
  assert.equal(result.diagnostics.gameContextCheck.ok, true);
  assert.equal(result.diagnostics.portal2LoreCheck.ok, true);
  assert.deepEqual(result.diagnostics.portal2LoreCheck.unsupported, []);
});

test('request timing trace records remaining budget and stays available in snapshots', () => {
  const ctx = createAIRequestContext({ requestId: 'timing-test', maxCzasMs: 5000 });
  const event = ctx.recordTiming('validator_start', { pass: 1, remainingBefore: ctx.remainingMs() });
  const snapshot = ctx.snapshot();

  assert.equal(event.stage, 'validator_start');
  assert.ok(event.elapsedMs >= 0);
  assert.ok(event.remainingMs >= 0 && event.remainingMs <= 5000);
  assert.equal(snapshot.timingTrace.length, 1);
  assert.equal(snapshot.timingTrace[0].pass, 1);
});
