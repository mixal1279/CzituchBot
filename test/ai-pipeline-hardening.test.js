'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure, shouldRetryFailure, retryAfterHint, quotaCooldownMsFromError } = require('../ai/fallback');
const { createRequestBudget, sanitizeRequestText } = require('../ai/limits');
const { extractAnswerSignals } = require('../ai/answer-plan');

test('provider failure classification prioritizes structured HTTP status over diagnostic metadata', () => {
  const error = {
    status: 429,
    message: 'rate limit exceeded',
    diagnostic: JSON.stringify({ status: 429, message: 'rate limit exceeded', timeoutMs: 9000 }),
  };
  assert.equal(classifyFailure(error), 'quota');
  assert.notEqual(classifyFailure(error), 'timeout_abort');
  assert.equal(shouldRetryFailure(classifyFailure(error)), true);
});

test('HTTP 429 capacity pressure is transient rather than a depleted quota', () => {
  assert.equal(classifyFailure({ status: 429, message: 'provider overloaded; high demand' }), 'transient');
});

test('Retry-After is honored from headers and error text', () => {
  assert.equal(retryAfterHint({ headers: { 'retry-after': '12' } }), 'Retry-After=12s');
  assert.equal(quotaCooldownMsFromError({ status: 429, message: 'rate limit; Retry-After=7s' }), 7000);
});

test('request budget enforces both global deadline and per-kind call caps', () => {
  const budget = createRequestBudget({ requestTimeoutMs: 1000, maxModelCalls: 1, maxValidators: 1 });
  assert.equal(budget.reserve('modelCalls'), true);
  assert.equal(budget.reserve('modelCalls'), false);
  assert.equal(budget.reserve('validator'), true);
  assert.equal(budget.reserve('validator'), false);
  assert.equal(budget.reserve('unknown-kind'), false);
});

test('request text sanitizer strips invisible controls and never exceeds the configured limit', () => {
  assert.equal(sanitizeRequestText('ab\\u200Bcd', 10), 'abcd');
  assert.equal(sanitizeRequestText('abcdef', 4), 'abcd');
});

test('purpose clauses satisfy why intent without being mislabeled as an explicit causal marker', () => {
  const motive = extractAnswerSignals('Wheatley przejął kontrolę, aby upokorzyć GLaDOS.');
  assert.equal(motive.why, true);
  assert.equal(motive.motive_explanation, true);
  assert.equal(motive.causal_explanation, true);

  const cause = extractAnswerSignals('Wheatley przejął kontrolę z powodu awarii systemu.');
  assert.equal(cause.why, true);
  assert.equal(cause.motive_explanation, false);
});
