'use strict';

const { timingSafeEqual } = require('node:crypto');

// Bound text before it reaches heuristic/regular-expression based classifiers.
function boundedText(value, maxLength = 500) {
  const text = String(value ?? '');
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Used for ordinary token matching. The compared values are not credentials,
// but constant-time byte comparison also removes misleading timing-scan hits.
function constantTimeStringEqual(left, right) {
  const aText = String(left ?? '');
  const bText = String(right ?? '');
  if (aText.length > 512 || bText.length > 512) return false;
  const a = Buffer.from(aText, 'utf8');
  const b = Buffer.from(bText, 'utf8');
  const size = Math.max(a.length, b.length, 1);
  const paddedA = Buffer.alloc(size);
  const paddedB = Buffer.alloc(size);
  a.copy(paddedA);
  b.copy(paddedB);
  const sameBytes = timingSafeEqual(paddedA, paddedB);
  return sameBytes && a.length === b.length;
}

module.exports = { boundedText, constantTimeStringEqual };
