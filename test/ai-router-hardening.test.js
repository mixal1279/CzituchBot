'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAIRequest } = require('../ai/router');

const policy = () => 'web_fact';

test('ambiguous short game character does not receive normal routing confidence', () => {
  const r = classifyAIRequest('Co robi Arthur?', policy);
  assert.equal(r.resolved_entity?.resolution, 'deterministic_ambiguous');
  assert.ok(r.confidence < 0.8);
  assert.notEqual(r.confidence_policy, 'normal');
});
