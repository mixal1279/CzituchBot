'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveClaimSourceIds } = require('../ai/validator');
const { parseEvidenceBlocks } = require('../ai/evidence');
const { czyNazwaWlasnaWystepuje } = require('../ai/claimValidation');

test('rebinds a stale source ID only when the exact quote has one unique authorized source', () => {
  const evidence = [
    '[SOURCE 1]',
    'TYTUŁ: unrelated page',
    'TREŚĆ: This page describes another character.',
    '[SOURCE 2]',
    'TYTUŁ: Trevor Philips',
    'TREŚĆ: In the late 1980s or early 90s, he met Michael Townley.',
  ].join('\n');
  const blocks = parseEvidenceBlocks(evidence);
  assert.deepEqual(
    resolveClaimSourceIds(blocks, ['SOURCE 8'], 'In the late 1980s or early 90s, he met Michael Townley.'),
    ['SOURCE 2'],
  );
});

test('does not guess when an exact quote occurs in multiple sources', () => {
  const evidence = [
    '[SOURCE 1]',
    'TYTUŁ: page one',
    'TREŚĆ: The same exact sentence appears here.',
    '[SOURCE 2]',
    'TYTUŁ: page two',
    'TREŚĆ: The same exact sentence appears here.',
  ].join('\n');
  const blocks = parseEvidenceBlocks(evidence);
  assert.deepEqual(
    resolveClaimSourceIds(blocks, ['SOURCE 8'], 'The same exact sentence appears here.'),
    ['SOURCE 8'],
  );
});

test('does not replace a valid source ID when its source contains the quote', () => {
  const evidence = [
    '[SOURCE 1]',
    'TYTUŁ: page one',
    'TREŚĆ: The exact sentence is present in this source.',
    '[SOURCE 2]',
    'TYTUŁ: page two',
    'TREŚĆ: The exact sentence is present in this source.',
  ].join('\n');
  const blocks = parseEvidenceBlocks(evidence);
  assert.deepEqual(
    resolveClaimSourceIds(blocks, ['SOURCE 2'], 'The exact sentence is present in this source.'),
    ['SOURCE 2'],
  );
});

test('localized Last Dragonborn title is recognized as the same proper name', () => {
  assert.equal(czyNazwaWlasnaWystepuje('last dragonborn', 'The Last Dragonborn was foretold.'), true);
  assert.equal(czyNazwaWlasnaWystepuje('last dragonborn', 'Ostatnim Dragonbornem'), true);
});

test('localized Prophecy of the Dragonborn title is recognized as the same proper name', () => {
  assert.equal(czyNazwaWlasnaWystepuje('prophecy of the dragonborn', 'The Prophecy of the Dragonborn'), true);
  assert.equal(czyNazwaWlasnaWystepuje('prophecy of the dragonborn', 'w Proroctwie Dragonborna'), true);
});
