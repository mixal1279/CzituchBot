'use strict';

// xKiro is an optional secondary validator. Its production deadline is
// intentionally strict (6 s); a slower response is degraded capacity, not a
// reason to prevent the independent Gemini/Groq-backed live benchmark from
// running. Transport, HTTP, malformed-output and other provider failures
// remain blocking in strict preflight.
function isBlockingPreflightFailure(result) {
  if (!result || result.verdict === 'OK') return false;
  return !(result.provider === 'xKiro' && /^ZA WOLNY dla produkcji/.test(String(result.verdict)));
}

module.exports = { isBlockingPreflightFailure };
