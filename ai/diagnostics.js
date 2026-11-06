'use strict';

const SAFE_ERROR_FIELDS = new Set([
  'name', 'message', 'code', 'type', 'status', 'statusCode',
  'param', 'request_id', 'requestId', 'errno', 'syscall', 'cause', 'error',
]);

function sanitizujKomunikatBledu(value, maxLength = 1600) {
  return String(value ?? 'unknown').slice(0, maxLength)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|token|api_key|access_token|client_secret)=)[^&\s]+/gi, '$1[REDACTED]');
}

function serializujBladProvidera(error) {
  if (!error || typeof error !== 'object') return null;
  const seen = new WeakSet();

  function visit(value, depth = 0) {
    if (value == null || depth > 3) return value;
    if (typeof value === 'string') return sanitizujKomunikatBledu(value, 1600);
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) return value.slice(0, 8).map(item => visit(item, depth + 1));

    const result = {};
    for (const key of Object.getOwnPropertyNames(value).slice(0, 40)) {
      if (!SAFE_ERROR_FIELDS.has(key)) continue;
      try {
        const nested = value[key];
        if (nested !== undefined) result[key] = visit(nested, depth + 1);
      } catch (_) {}
    }
    return result;
  }

  return visit(error);
}

module.exports = { serializujBladProvidera, sanitizujKomunikatBledu };
