'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeUntrustedText } = require('../ai/untrustedText');

test('removes opening and closing untrusted block tags with whitespace and mixed case', () => {
  const input = 'before <  UNTRUSTED_SOURCE  >payload< / untrusted_source > after';
  const output = sanitizeUntrustedText(input);
  assert.equal(output, 'before [USUNIĘTY_ZNACZNIK_BLOKU] payload[USUNIĘTY_ZNACZNIK_BLOKU] after');
});

test('preserves ordinary HTML tags and removes untrusted tags embedded in text', () => {
  const output = sanitizeUntrustedText('<p>hello</p> <UNTRUSTED_END>world');
  assert.equal(output, '<p>hello</p> [USUNIĘTY_ZNACZNIK_BLOKU]world');
});

test('handles adversarial runs of spaces and underscores without losing surrounding text', () => {
  const spaces = '<' + ' '.repeat(50000) + 'x';
  const underscores = '<UNTRUSTED_' + '_'.repeat(50000) + 'x>';
  const start = performance.now();
  const output = sanitizeUntrustedText(spaces + ' ' + underscores);
  const elapsed = performance.now() - start;

  assert.ok(output.includes(spaces));
  assert.ok(output.includes('[USUNIĘTY_ZNACZNIK_BLOKU]'));
  assert.ok(elapsed < 2000, `sanitization took ${elapsed.toFixed(0)}ms`);
});

test('handles many angle brackets before a closing bracket without repeated rescanning', () => {
  const input = '<'.repeat(50000) + '>';
  const start = performance.now();
  const output = sanitizeUntrustedText(input);
  const elapsed = performance.now() - start;

  assert.ok(output.length > 0);
  assert.ok(elapsed < 2000, `sanitization took ${elapsed.toFixed(0)}ms`);
});
