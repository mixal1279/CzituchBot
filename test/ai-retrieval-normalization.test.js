'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizujToken,
  buildAdvancedRetrievalPlan,
  sourceQualityScore,
} = require('../ai/retrieval');

test('retrieval normalization removes Polish diacritics and collapses whitespace', () => {
  assert.equal(normalizujToken('  ŻÓŁĆ   i   Łódź  '), 'zolc i lodz');
});

test('retrieval plan deduplicates queries differing only by whitespace or diacritics', () => {
  const plan = buildAdvancedRetrievalPlan('', {}, [
    'Unique Query Alpha',
    'Unique   Query Alpha',
    'Żółć query topic',
    'Zolc query topic',
  ]);

  assert.deepEqual(plan.map(item => item.query), [
    'Unique Query Alpha',
    'Żółć query topic',
  ]);
});

test('retrieval source quality accepts canonical and legacy authority labels', () => {
  assert.equal(sourceQualityScore({ score: 0.5, authority: 'official' }), 0.75);
  assert.equal(sourceQualityScore({ score: 0.5, authority: 'oficjalne' }), 0.75);
  assert.equal(sourceQualityScore({ score: 0.5, authority: 'specialized' }), 0.7);
  assert.equal(sourceQualityScore({ score: 0.5, authority: 'wyspecjalizowane' }), 0.7);
  assert.equal(sourceQualityScore({ score: 0.5, authority: 'guide' }), 0.58);
});
