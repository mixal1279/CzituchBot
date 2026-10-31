'use strict';

// xKiro and OpenRouter are secondary validators. Their degraded availability
// must be visible in preflight, but must not prevent the independent
// Gemini/Groq-backed benchmark from running.
//
// An xKiro request that reaches the preflight's own deadline is treated as
// optional capacity degradation: the free-tier endpoint can be slower than
// the probe budget, and production already enforces a shorter per-request
// deadline. Keep explicit network, HTTP, authentication, malformed-output and
// other provider failures blocking so genuine configuration faults stay visible.
// For OpenRouter, tolerate only an empty successful response (HTTP 200,
// finish=null); other malformed responses remain blocking.
function isBlockingPreflightFailure(result) {
  if (!result || result.verdict === 'OK') return false;
  const verdict = String(result.verdict);
  if (result.provider === 'xKiro' && /^ZA WOLNY dla produkcji/.test(verdict)) return false;
  if (result.provider === 'xKiro' && /^TIMEOUT >\d+ ms$/.test(verdict)) return false;
  if (result.provider === 'OpenRouter' && /^PUSTY content \(finish=null\)$/.test(verdict)) return false;
  return true;
}

module.exports = { isBlockingPreflightFailure };
