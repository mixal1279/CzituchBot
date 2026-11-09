'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvidenceText } = require('../ai/evidence');
const { buildAliasPattern, buildEntityAliasPatterns } = require('../ai/entityAliases');

test('normalizacja linków markdown zachowuje etykietę i nie wymaga zagnieżdżonego regexu', () => {
  assert.equal(normalizeEvidenceText('Zobacz [Portal 2](https://example.com/portal-2).'), 'zobacz portal 2');
  assert.equal(normalizeEvidenceText('![obraz](https://example.com/a.png)'), '');
});

test('normalizacja dowodu obsługuje maksymalny limit tekstu z nawiasami i nawiasami kwadratowymi', () => {
  const fragment = '[etykieta](https://example.test/a(b)c) [';
  const input = fragment.repeat(2000);
  const result = normalizeEvidenceText(input);
  assert.ok(result.length <= 12000);
  assert.ok(result.length > 0);
});

test('aliasy są ograniczane i budowane wyłącznie z bezpiecznych, znormalizowanych tokenów', () => {
  assert.equal(buildAliasPattern([]), null);
  assert.equal(buildAliasPattern(['x'.repeat(121)]), null);
  const pattern = buildAliasPattern(['Portal 2']);
  assert.ok(pattern instanceof RegExp);
  assert.equal(pattern.test('Portal 2'), true);
  assert.equal(pattern.test('unrelated text'), false);
  assert.ok(buildEntityAliasPatterns().length > 0);
});
