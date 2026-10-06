'use strict';

const MAX_RECENT = 200;
const MAX_BUCKET_KEYS = 40;

function boundedIncrement(map, key) {
  const normalized = String(key || 'unknown').slice(0, 80);
  if (!Object.prototype.hasOwnProperty.call(map, normalized) && Object.keys(map).length >= MAX_BUCKET_KEYS) {
    map.other = (map.other || 0) + 1;
    return;
  }
  map[normalized] = (map[normalized] || 0) + 1;
}

function createAIMetrics() {
  return {
    requests: 0, accepted: 0, rejected: 0, inconclusive: 0, unavailable: 0, errors: 0,
    totalLatencyMs: 0, totalModelCalls: 0, totalTavilySearches: 0,
    providerCalls: {}, fallbackReasons: {}, validatorStatuses: {}, retrievalStatuses: {},
    recent: [],
  };
}

function recordAIMetric(metrics, event = {}) {
  const m = metrics || createAIMetrics();
  const latency = Math.max(0, Number(event.latencyMs) || 0);
  const status = String(event.status || 'unknown');
  m.requests++;
  if (Object.prototype.hasOwnProperty.call(m, status)) m[status]++;
  m.totalLatencyMs += latency;
  m.totalModelCalls += Number(event.modelCalls) || 0;
  m.totalTavilySearches += Number(event.tavilySearches) || 0;

  for (const provider of Array.isArray(event.providers) ? event.providers : []) boundedIncrement(m.providerCalls, provider);
  for (const reason of Array.isArray(event.fallbackReasons) ? event.fallbackReasons : []) boundedIncrement(m.fallbackReasons, reason);
  for (const validatorStatus of Array.isArray(event.validatorStatuses) ? event.validatorStatuses : []) boundedIncrement(m.validatorStatuses, validatorStatus);
  for (const retrievalStatus of Array.isArray(event.retrievalStatuses) ? event.retrievalStatuses : []) boundedIncrement(m.retrievalStatuses, retrievalStatus);

  m.recent.push({
    at: Date.now(), status, latencyMs: latency,
    modelCalls: Number(event.modelCalls) || 0,
    tavilySearches: Number(event.tavilySearches) || 0,
    category: event.category || null,
    providers: Array.isArray(event.providers) ? event.providers.slice(0, 8) : [],
    fallbackReasons: Array.isArray(event.fallbackReasons) ? event.fallbackReasons.slice(0, 8) : [],
    validatorStatuses: Array.isArray(event.validatorStatuses) ? event.validatorStatuses.slice(0, 8) : [],
    retrievalStatuses: Array.isArray(event.retrievalStatuses) ? event.retrievalStatuses.slice(0, 8) : [],
  });
  if (m.recent.length > MAX_RECENT) m.recent.splice(0, m.recent.length - MAX_RECENT);
  return m;
}

function snapshotAIMetrics(metrics) {
  const m = metrics || createAIMetrics();
  return {
    ...m,
    avgLatencyMs: m.requests ? Math.round(m.totalLatencyMs / m.requests) : 0,
    avgModelCalls: m.requests ? Number((m.totalModelCalls / m.requests).toFixed(2)) : 0,
    avgTavilySearches: m.requests ? Number((m.totalTavilySearches / m.requests).toFixed(2)) : 0,
  };
}

module.exports = { createAIMetrics, recordAIMetric, snapshotAIMetrics };