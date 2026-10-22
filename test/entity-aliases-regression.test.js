'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEntityAliasPatterns, ENTITY_ALIAS_GROUPS } = require('../ai/entityAliases');

test('ambiguous Polish Skyrim name Smocza Zguba is not globally aliased to Dragonrend', () => {
  const dragonrend = buildEntityAliasPatterns().find(entry => entry.canonical === 'dragonrend');
  assert.ok(dragonrend, 'Dragonrend alias group should remain available');
  assert.equal(dragonrend.pattern.test('Dragonrend'), true);
  assert.equal(dragonrend.pattern.test('Smocza Zguba'), false);
  assert.equal(
    ENTITY_ALIAS_GROUPS.some(group => group.canonical === 'dragonrend'
      && group.names.some(name => name.toLocaleLowerCase('pl-PL') === 'smocza zguba')),
    false,
  );
});
