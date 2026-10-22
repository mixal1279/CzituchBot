'use strict';
// Regresja dla punktu 1 recenzji: Number(null) === 0, więc brak wartości był
// liczony jak 0 — „jakość tylko dla wydanych odpowiedzi” nie działało, bo
// brak jakości zaniżał średnią tak samo jak odpowiedź o jakości zero.
const test = require('node:test');
const assert = require('node:assert');

const { createAIMetrics, recordAIMetric, snapshotAIMetrics } = require('../ai/metrics');

test('brak wartości nie jest liczony jako zero', () => {
  const metrics = createAIMetrics();
  recordAIMetric(metrics, { answerQuality: null, validatorConfidence: null, claimCoverage: null });
  const snap = snapshotAIMetrics(metrics);
  assert.equal(snap.qualitySamples, 0, 'brak jakości nie może zwiększać licznika próbek');
  assert.equal(snap.validatorConfidenceSamples, 0);
  assert.equal(snap.claimCoverageSamples, 0);
  assert.equal(snap.avgAnswerQuality, null);
  assert.equal(snap.avgValidatorConfidence, null);
});

test('prawdziwe zero nadal jest liczone', () => {
  const metrics = createAIMetrics();
  recordAIMetric(metrics, { answerQuality: 0, validatorConfidence: 0, claimCoverage: 0 });
  const snap = snapshotAIMetrics(metrics);
  assert.equal(snap.qualitySamples, 1);
  assert.equal(snap.avgAnswerQuality, 0);
});

test('średnia liczy tylko odpowiedzi z wartością', () => {
  const metrics = createAIMetrics();
  recordAIMetric(metrics, { answerQuality: 1 });
  recordAIMetric(metrics, { answerQuality: null });
  recordAIMetric(metrics, { answerQuality: 0.5 });
  const snap = snapshotAIMetrics(metrics);
  assert.equal(snap.qualitySamples, 2);
  assert.equal(snap.avgAnswerQuality, 0.75);
});

test('zdarzenie bez pól nie tworzy próbek', () => {
  const metrics = createAIMetrics();
  recordAIMetric(metrics, {});
  const snap = snapshotAIMetrics(metrics);
  assert.equal(snap.qualitySamples, 0);
  assert.equal(snap.avgAnswerQuality, null);
});
