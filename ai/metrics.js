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
    retries: 0, retryAccepted: 0, retryRejected: 0, supplementalRetrievals: 0, supplementalSuccesses: 0, sourceDiversityFailures: 0, falseAccepts: 0, falseRejects: 0, discardedAnswers: 0, discardedAnswerSamples: 0, claimCoverageSum: 0, claimCoverageSamples: 0, answerQualitySum: 0, qualitySamples: 0, validatorConfidenceSum: 0, validatorConfidenceSamples: 0,
    totalLatencyMs: 0, totalModelCalls: 0, totalTavilySearches: 0,
    providerCalls: {}, fallbackReasons: {}, validatorStatuses: {}, retrievalStatuses: {},
    generationAttempts: [], recent: [],
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
  if (event.retry) m.retries++;
  if (event.retryAccepted) m.retryAccepted++;
  if (event.retryRejected) m.retryRejected++;
  if (event.supplementalRetrieval) m.supplementalRetrievals++;
  if (event.supplementalSuccess) m.supplementalSuccesses++;
  if (event.sourceDiversityFailure) m.sourceDiversityFailures++;
  if (event.falseAccept) m.falseAccepts++;
  if (event.falseReject) m.falseRejects++;
  // Odrzucona treść: pipeline wyrzucił odpowiedź w zamian za odmowę.
  if (event.discardedAnswer) m.discardedAnswers++;
  if (typeof event.discardedAnswerText === 'string' && event.discardedAnswerText.trim()) m.discardedAnswerSamples++;
  // Number(null) === 0, a Number.isFinite(0) === true — brak wartości byłby więc
  // liczony jako 0, czyli „jakość tylko dla wydanych odpowiedzi” nie działałoby:
  // brak jakości zaniżałby średnią tak samo jak odpowiedź o jakości zero.
  if (event.claimCoverage != null && Number.isFinite(Number(event.claimCoverage))) {
    m.claimCoverageSum += Math.max(0, Math.min(1, Number(event.claimCoverage)));
    m.claimCoverageSamples++;
  }
  if (event.answerQuality != null && Number.isFinite(Number(event.answerQuality))) { m.answerQualitySum += Math.max(0, Math.min(1, Number(event.answerQuality))); m.qualitySamples++; }
  // Confidence walidatora to osobna wielkość niż jakość odpowiedzi: opisuje
  // werdykt, a nie to, co trafiło do użytkownika.
  if (event.validatorConfidence != null && Number.isFinite(Number(event.validatorConfidence))) { m.validatorConfidenceSum += Math.max(0, Math.min(1, Number(event.validatorConfidence))); m.validatorConfidenceSamples++; }

  for (const provider of Array.isArray(event.providers) ? event.providers : []) boundedIncrement(m.providerCalls, provider);
  for (const reason of Array.isArray(event.fallbackReasons) ? event.fallbackReasons : []) boundedIncrement(m.fallbackReasons, reason);
  for (const validatorStatus of Array.isArray(event.validatorStatuses) ? event.validatorStatuses : []) boundedIncrement(m.validatorStatuses, validatorStatus);
  for (const retrievalStatus of Array.isArray(event.retrievalStatuses) ? event.retrievalStatuses : []) boundedIncrement(m.retrievalStatuses, retrievalStatus);
  for (const attempt of Array.isArray(event.generationAttempts) ? event.generationAttempts.slice(-20) : []) {
    m.generationAttempts.push({
      provider: String(attempt.provider || 'unknown'),
      model: String(attempt.model || 'unknown'),
      phase: String(attempt.phase || 'initial'),
      status: String(attempt.status || 'unknown'),
      failure: attempt.failure ? String(attempt.failure) : null,
      latencyMs: Math.max(0, Number(attempt.latencyMs) || 0),
    });
  }
  if (m.generationAttempts.length > 200) m.generationAttempts.splice(0, m.generationAttempts.length - 200);

  m.recent.push({
    at: Date.now(), status, latencyMs: latency,
    modelCalls: Number(event.modelCalls) || 0,
    tavilySearches: Number(event.tavilySearches) || 0,
    category: event.category || null,
    providers: Array.isArray(event.providers) ? event.providers.slice(0, 8) : [],
    fallbackReasons: Array.isArray(event.fallbackReasons) ? event.fallbackReasons.slice(0, 8) : [],
    validatorStatuses: Array.isArray(event.validatorStatuses) ? event.validatorStatuses.slice(0, 8) : [],
    retrievalStatuses: Array.isArray(event.retrievalStatuses) ? event.retrievalStatuses.slice(0, 8) : [],
    claimCoverage: event.claimCoverage != null && Number.isFinite(Number(event.claimCoverage)) ? Number(event.claimCoverage) : null,
    answerQuality: event.answerQuality != null && Number.isFinite(Number(event.answerQuality)) ? Number(event.answerQuality) : null,
    generationAttempts: Array.isArray(event.generationAttempts) ? event.generationAttempts.slice(-20) : [],
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
    avgClaimCoverage: m.claimCoverageSamples ? Number((m.claimCoverageSum / m.claimCoverageSamples).toFixed(3)) : null,
    avgAnswerQuality: m.qualitySamples ? Number((m.answerQualitySum / m.qualitySamples).toFixed(3)) : null,
    avgValidatorConfidence: m.validatorConfidenceSamples ? Number((m.validatorConfidenceSum / m.validatorConfidenceSamples).toFixed(3)) : null,
  };
}

module.exports = { createAIMetrics, recordAIMetric, snapshotAIMetrics };