'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceMatchesRequestContext } = require('../ai/core');

const portalRouting = {
  is_lore: true,
  entity_type: 'game',
  game: 'Portal',
  resolved_entity: { type: 'game', name: 'Portal', game: 'Portal' },
};

test('lore retrieval rejects a sequel when the resolved entity is the base game', () => {
  assert.equal(sourceMatchesRequestContext({ title: 'Portal 2: Wheatley', content: 'Portal 2 lore' }, portalRouting), false);
  assert.equal(sourceMatchesRequestContext({ title: 'Portal Part II', content: 'Portal Part II lore' }, portalRouting), false);
  assert.equal(sourceMatchesRequestContext({ title: 'Portal Chapter 3', content: 'Portal Chapter 3 lore' }, portalRouting), false);
});

test('lore retrieval retains the exact base game and an explicitly requested sequel', () => {
  assert.equal(sourceMatchesRequestContext({ title: 'Portal', content: 'Portal lore' }, portalRouting), true);
  const sequelRouting = {
    ...portalRouting,
    game: 'Portal 2',
    resolved_entity: { type: 'game', name: 'Portal 2', game: 'Portal 2' },
  };
  assert.equal(sourceMatchesRequestContext({ title: 'Portal 2: Wheatley', content: 'Portal 2 lore' }, sequelRouting), true);
});

test('franchise-scoped retrieval is not incorrectly narrowed to one game', () => {
  const franchiseRouting = {
    is_lore: true,
    entity_type: 'franchise',
    resolved_entity: { type: 'franchise', name: 'Portal', game: null },
  };
  assert.equal(sourceMatchesRequestContext({ title: 'Portal 2: Wheatley', content: 'Portal 2 lore' }, franchiseRouting), true);
});
