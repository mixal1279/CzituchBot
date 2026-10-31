'use strict';

// xKiro and OpenRouter are secondary validators. Their degraded availability
// must be visible in preflight, but must not prevent the independent
// Gemini/Groq-backed benchmark from running. Keep transport/HTTP failures
// blocking for xKiro; for OpenRouter, specifically tolerate an empty successful
// response because some routed free-tier endpoints return HTTP 200 with no
// completion. Other malformed OpenRouter responses remain blocking.
function isBlockingPreflightFailure(result) {
  if (!result || result.verdict === 'OK') return false;
  const verdict = String(result.verdict);
  if (result.provider === 'xKiro' && /^ZA WOLNY dla produkcji/.test(verdict)) return false;
  if (result.provider === 'OpenRouter' && /^PUSTY content \(finish=null\)$/.test(verdict)) return false;
  return true;
}

module.exports = { isBlockingPreflightFailure };
