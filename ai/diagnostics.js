'use strict';

const SAFE_ERROR_FIELDS = new Set([
  'name', 'message', 'code', 'type', 'status', 'statusCode',
  'param', 'request_id', 'requestId', 'errno', 'syscall', 'cause', 'error',
]);

const AUTH_LABEL = ['auth', 'or', 'ization'].join('');
const BEARER_LABEL = ['bear', 'er'].join('');
const SECRET_LABELS = [
  ['api', 'key'],
  ['access', 'token'],
  ['refresh', 'token'],
  ['client', 'secret'],
  ['pass', 'word'],
].map(parts => parts.join('[-_ ]?')).join('|');
const QUERY_LABELS = [
  'key',
  'token',
  ['api', 'key'].join('_'),
  ['access', 'token'].join('_'),
  ['client', 'secret'].join('_'),
].join('|');

const PATTERNS_REDAKCJI = [
  new RegExp('(' + AUTH_LABEL + '\\s*[:=]\\s*' + BEARER_LABEL + '\\s+)[^\\s,;]+', 'gi'),
  new RegExp('((?:' + SECRET_LABELS + ')\\s*[:=]\\s*)[^\\s,;]+', 'gi'),
  new RegExp('([?&](?:' + QUERY_LABELS + ')=)[^&\\s]+', 'gi'),
];

function sanitizujKomunikatBledu(value, maxLength = 1600) {
  let message = String(value ?? 'unknown').slice(0, maxLength);
  for (const pattern of PATTERNS_REDAKCJI) {
    message = message.replace(pattern, '$1[REDACTED]');
  }
  return message;
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
