'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { agregujMetrykiWalidatorow, zbudujKontekstMetrykiWalidatora } = require('../ai/validator-telemetry');

function metric(result, options = {}) {
  return zbudujKontekstMetrykiWalidatora(
    'req-1',
    options.validator || 'gemini',
    options.model || 'test-model',
    options.answer || 'Ciri jest postacią z gry Wiedźmin 3.',
    options.sources || '[SOURCE 1] Title\ncontent\n[SOURCE 2] Title\ncontent',
    null,
    options.remainingMsAtStart ?? 12000,
    options.timeoutMs ?? 9000,
    options.startedAt ?? Date.now() - 100,
    result,
    options.outcome || 'attempted',
  );
}

test('skipped provider-side deadline is not counted as attempted', () => {
  const result = metric({ status: 'unavailable', skipped: true, reason: 'zbyt mały pozostały budżet czasu' });
  assert.equal(result.outcome, 'skipped_budget');
  assert.equal(result.failureReason, 'budget_exhausted');
  assert.equal(result.actualMs, null);
});

test('Gemini high demand is classified as overload, not HTTP error or quota', () => {
  const result = metric({
    status: 'unavailable',
    reason: 'przejściowy błąd validatora — fallback',
    diagnostic: '{"status":503,"message":"high demand"}',
  });
  assert.equal(result.failureReason, 'provider_overload');
});

test('explicit Gemini quota is classified consistently as quota', () => {
  const result = metric({
    status: 'unavailable',
    quota: true,
    reason: 'quota Gemini — przełączam validator',
    diagnostic: '{"status":429,"quota":true}',
  });
  assert.equal(result.failureReason, 'quota');
});

test('AbortError/abortLike is classified as timeout', () => {
  const result = metric({
    status: 'unavailable',
    reason: 'Gemini validator został anulowany',
    diagnostic: '{"abortLike":true}',
  });
  assert.equal(result.failureReason, 'timeout');
});

test('successful or decisive validation never receives a transport failure reason', () => {
  const result = metric({ status: 'accepted', reason: 'timeout text should not override accepted status' });
  assert.equal(result.failureReason, null);
});

test('validator sourceCount matches SUMMARY source-block counting', () => {
  const result = metric({ status: 'unavailable', reason: 'provider unavailable' });
  assert.equal(result.sourceCount, 2);
});

test('aggregates preserve every raw record and distinguish skip categories', () => {
  const raw = [
    metric({ status: 'unavailable', skipped: true, reason: 'deadline' }),
    metric({ status: 'unavailable', reason: 'HTTP 503 high demand', diagnostic: 'HTTP 503 high demand' }),
    metric({ status: 'unavailable', quota: true, reason: 'quota exceeded' }),
  ];
  const aggregate = agregujMetrykiWalidatorow(raw).gemini;
  assert.equal(aggregate.attempted, 2);
  assert.equal(aggregate.skippedBudget, 1);
  assert.equal(aggregate.providerOverloads, 1);
  assert.equal(aggregate.quotas, 1);
  assert.equal(
    aggregate.attempted + aggregate.skippedBudget + aggregate.skippedSlot + aggregate.skippedProvider,
    raw.length,
  );
});


test('missing credentials are visible as skipped provider, not attempted', () => {
  const result = metric(
    { status: 'unavailable', reason: 'brak XKIRO_API_KEY' },
    { outcome: 'skipped_provider' },
  );
  assert.equal(result.outcome, 'skipped_provider');
  assert.equal(result.failureReason, 'missing_credentials');
  assert.equal(result.actualMs, null);
});
