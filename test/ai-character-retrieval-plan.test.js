'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRetrievalPlan } = require('../ai/core');

test('retrieval builds a focused query for all named characters when router entity is the game', () => {
  const question = 'W grze Portal 2: Dlaczego Wheatley przejął kontrolę nad GLaDOS?';
  const plan = buildRetrievalPlan(question, {
    needs_web: true,
    entity_type: 'character',
    entity: 'Portal 2',
    game: 'Portal 2',
    question_type: 'lore',
  }, { maxQueries: 4 });

  assert.equal(plan[0].query, question);
  assert.match(plan[1].query, /Wheatley/);
  assert.match(plan[1].query, /GLaDOS/);
  assert.match(plan[1].query, /Portal 2/);
  assert.match(plan[1].query, /reason cause motivation/i);
  assert.doesNotMatch(plan[1].query, /W grze Portal 2/);
});
