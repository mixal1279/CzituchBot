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
// OpenRouter is also secondary capacity: a valid but over-budget response
// (or probe deadline timeout) is degraded optional capacity, not a reason to
// skip the independent Gemini/Groq benchmark. Empty successful responses are
// tolerated as before; HTTP/auth/network and malformed-output failures block.
function isBlockingPreflightFailure(result) {
  if (!result || result.verdict === 'OK') return false;
  const verdict = String(result.verdict);
  if (result.provider === 'xKiro' && /^ZA WOLNY dla produkcji/.test(verdict)) return false;
  if (result.provider === 'xKiro' && /^TIMEOUT >\d+ ms$/.test(verdict)) return false;
  if (result.provider === 'OpenRouter' && /^ZA WOLNY dla produkcji/.test(verdict)) return false;
  if (result.provider === 'OpenRouter' && /^TIMEOUT >\d+ ms$/.test(verdict)) return false;
  if (result.provider === 'OpenRouter' && /^PUSTY content \(finish=null\)$/.test(verdict)) return false;
  return true;
}

module.exports = { isBlockingPreflightFailure };
