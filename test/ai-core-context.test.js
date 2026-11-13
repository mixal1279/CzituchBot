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


test('franchise retrieval accepts sources about different entries in the same franchise', () => {
  const routing = {
    is_lore: true,
    entity_type: 'franchise',
    entity: 'The Witcher',
    resolved_entity: { type: 'franchise', name: 'The Witcher', game: null },
  };
  assert.equal(sourceMatchesRequestContext({ title: 'The Witcher 3: Wild Hunt', content: 'Geralt in The Witcher 3' }, routing), true);
  assert.equal(sourceMatchesRequestContext({ title: 'Cyberpunk 2077', content: 'Night City lore' }, routing), false);
});

test('franchise retrieval does not silently narrow to the first game', () => {
  const routing = {
    is_lore: true,
    entity_type: 'franchise',
    entity: 'Portal',
    resolved_entity: { type: 'franchise', name: 'Portal', game: null },
  };
  assert.equal(sourceMatchesRequestContext({ title: 'Portal 2 story', content: 'Wheatley and GLaDOS' }, routing), true);
  assert.equal(sourceMatchesRequestContext({ title: 'Portal story', content: 'Chell and GLaDOS' }, routing), true);
});
