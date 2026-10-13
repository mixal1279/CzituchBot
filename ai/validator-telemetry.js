'use strict';

function agregujMetrykiWalidatorow(metrics = []) {
  const byValidator = {};
  for (const metric of metrics) {
    const key = metric.validator || 'unknown';
    const row = byValidator[key] ||= {
      attempted: 0, skippedBudget: 0, skippedSlot: 0, avgMs: null,
      timeouts: 0, quotas: 0, providerOverloads: 0, httpErrors: 0,
      emptyResponses: 0, invalidJson: 0,
      unavailable: 0, accepted: 0, softAccepted: 0, rejected: 0,
    };
    if (metric.outcome === 'attempted') row.attempted++;
    if (metric.outcome === 'skipped_budget') row.skippedBudget++;
    if (metric.outcome === 'skipped_slot') row.skippedSlot++;
    if (metric.failureReason === 'timeout') row.timeouts++;
    if (metric.failureReason === 'quota') row.quotas++;
    if (metric.failureReason === 'provider_overload') row.providerOverloads++;
    if (metric.failureReason === 'http_error') row.httpErrors++;
    if (metric.failureReason === 'empty_response') row.emptyResponses++;
    if (metric.failureReason === 'invalid_json') row.invalidJson++;
    if (metric.status === 'unavailable') row.unavailable++;
    if (metric.status === 'accepted') row.accepted++;
    if (metric.status === 'soft_accepted') row.softAccepted++;
    if (metric.status === 'rejected') row.rejected++;
    if (Number.isFinite(metric.actualMs) && metric.outcome === 'attempted') {
      row._totalMs = (row._totalMs || 0) + metric.actualMs;
      row._timedCalls = (row._timedCalls || 0) + 1;
    }
  }
  for (const row of Object.values(byValidator)) {
    row.avgMs = row._timedCalls ? Math.round(row._totalMs / row._timedCalls) : null;
    delete row._totalMs;
    delete row._timedCalls;
  }
  return byValidator;
}

function zbudujKontekstMetrykiWalidatora(requestId, validator, model, odpowiedz, dane, requestState, remainingMsAtStart, timeoutMs, startedAt, result, outcome = 'attempted') {
  // A provider wrapper may discover that the deadline expired after the outer
  // preflight. Do not count that no-fetch path as an attempted network call.
  const resolvedOutcome = outcome === 'attempted' && result?.skipped === true
    ? 'skipped_budget'
    : outcome;
  let sourceCount = null;
  try {
    // Match SUMMARY.sourceCount exactly: count source/reference blocks, not unique IDs.
    sourceCount = dane
      ? (String(dane).match(/\[(?:SOURCE|REFERENCE) [^\]]+\]/g) || []).length
      : 0;
  } catch {}
  const answer = String(odpowiedz || '');
  const diagnosticText = [result?.reason, result?.diagnostic, result?.error]
    .map(value => typeof value === 'string' ? value : value ? JSON.stringify(value) : '')
    .join(' ')
    .toLowerCase();
  const isTerminal = ['accepted', 'soft_accepted', 'rejected'].includes(result?.status);
  const isOverload = /high demand|overloaded|temporarily unavailable|capacity exceeded|server busy/i.test(diagnosticText);
  const isQuota = result?.quota === true
    || /quotaexceeded|quota exceeded|rate.?limit|resource.?exhausted|insufficient quota|billing hard limit/i.test(diagnosticText);
  const isTimeout = result?.abortLike === true
    || /abortlike["']?\s*[:=]\s*["']?true|aborterror|aborted|abort|cancelled|canceled|anulowan|timeout|timed out|etimedout/i.test(diagnosticText);
  const failureReason = resolvedOutcome === 'skipped_budget' ? 'budget_exhausted'
    : resolvedOutcome === 'skipped_slot' ? 'slot_unavailable'
    : isTerminal ? null
    : isQuota ? 'quota'
    : isOverload ? 'provider_overload'
    : isTimeout ? 'timeout'
    : /empty|pusta odpowiedź|brak treści|brak odpowiedzi/i.test(diagnosticText) ? 'empty_response'
    : /json|pars|schema|format odpowiedzi/i.test(diagnosticText) ? 'invalid_json'
    : /http|status code|\b4\d\d\b|\b5\d\d\b/.test(diagnosticText) ? 'http_error'
    : result?.status === 'unavailable' ? 'provider_unavailable'
    : null;
  const claimCountHeuristic = answer.trim()
    ? answer.split(/[.!?;]+|\n+/).map(part => part.trim()).filter(part => part.length >= 12).length
    : 0;
  return {
    requestId, validator, model, outcome: resolvedOutcome, remainingMsAtStart, timeoutMs,
    actualMs: resolvedOutcome === 'attempted' && Number.isFinite(startedAt)
      ? Math.max(0, Date.now() - startedAt)
      : null,
    status: result?.status || 'unavailable', failureReason, sourceCount,
    answerLength: answer.length, claimCountHeuristic, tavilyChars: null,
  };
}

module.exports = { agregujMetrykiWalidatorow, zbudujKontekstMetrykiWalidatora };
