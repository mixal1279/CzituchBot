'use strict';

// Transient provider availability and latency problems should not prevent the
// diagnostic benchmark from running. The benchmark itself remains responsible
// for marking measurements invalid when a primary provider is unavailable.
// Authentication, configuration, malformed-output and other deterministic
// failures remain blocking so CI still exposes actionable setup regressions.
function isTransientTransportFailure(result, verdict) {
  const status = Number.isInteger(Number(result?.http))
    ? Number(result.http)
    : Number(String(verdict).match(/\\bHTTP\\s+(\\d{3})\\b/i)?.[1] || 0);

  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) return true;
  if (/^TIMEOUT >\\d+ ms$/i.test(verdict)) return true;
  if (/^ZA WOLNY dla produkcji/i.test(verdict)) return true;
  return false;
}

function isBlockingPreflightFailure(result) {
  if (!result || result.verdict === 'OK') return false;
  const verdict = String(result.verdict);

  if (isTransientTransportFailure(result, verdict)) return false;

  // An empty successful OpenRouter response is degraded optional capacity.
  if (result.provider === 'OpenRouter' && /^PUSTY content \\(finish=null\\)$/.test(verdict)) return false;

  return true;
}

module.exports = { isBlockingPreflightFailure, isTransientTransportFailure };
