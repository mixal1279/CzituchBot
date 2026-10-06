'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIMetrics, recordAIMetric, snapshotAIMetrics } = require('../ai/metrics');

test('AI observability records provider, fallback, validator and retrieval dimensions', () => {
  const metrics = createAIMetrics();
  recordAIMetric(metrics, {
    status: 'accepted',
    latencyMs: 123,
    modelCalls: 3,
    tavilySearches: 1,
    category: 'gameplay',
    providers: ['groq/openai/gpt-oss-20b'],
    fallbackReasons: ['quota'],
    validatorStatuses: ['rejected', 'accepted'],
    retrievalStatuses: ['secondary'],
  });
  const snapshot = snapshotAIMetrics(metrics);
  assert.equal(snapshot.providerCalls['groq/openai/gpt-oss-20b'], 1);
  assert.equal(snapshot.fallbackReasons.quota, 1);
  assert.equal(snapshot.validatorStatuses.rejected, 1);
  assert.equal(snapshot.validatorStatuses.accepted, 1);
  assert.equal(snapshot.retrievalStatuses.secondary, 1);
  assert.equal(snapshot.avgLatencyMs, 123);
});

test('AI observability buckets remain bounded', () => {
  const metrics = createAIMetrics();
  for (let i = 0; i < 100; i++) {
    recordAIMetric(metrics, { providers: [`provider-${i}`], fallbackReasons: [`reason-${i}`] });
  }
  assert.ok(Object.keys(metrics.providerCalls).length <= 41);
  assert.ok(Object.keys(metrics.fallbackReasons).length <= 41);
  assert.ok(metrics.recent.length <= 200);
});
