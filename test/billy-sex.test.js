'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSexResponse, SCENARIUSZE_SOLO, SCENARIUSZE_DLA_DWOJGA } = require('../billy-sex');

test('!sex losuje scenariusz solo dla autora', () => {
  const response = buildSexResponse({ message: '!sex', nick: 'Viewer', rng: () => 0 });
  assert.match(response, /^@Viewer – /);
  assert.match(response, /Maślana Rozkosz/);
  assert.equal(response.includes('%'), false);
});

test('!sex @nick losuje scenariusz dla dwóch osób', () => {
  const response = buildSexResponse({ message: '!sex @NickInnejOsoby', nick: 'Viewer', rng: () => 0 });
  assert.match(response, /^@Viewer i @NickInnejOsoby /);
  assert.match(response, /Maślana Rozkosz/);
  assert.equal(response.includes('%'), false);
});

test('!sex obsługuje scenariusze skrajne obu pul', () => {
  const solo = buildSexResponse({ message: '!sex', nick: 'Viewer', rng: () => 0.999999 });
  const duo = buildSexResponse({ message: '!sex Ala', nick: 'Viewer', rng: () => 0.999999 });
  assert.match(solo, /Sanepid został już powiadomiony/);
  assert.match(duo, /Sanepid już jedzie na miejsce/);
  assert.equal(SCENARIUSZE_SOLO.length, 4);
  assert.equal(SCENARIUSZE_DLA_DWOJGA.length, 4);
});

test('!sex akceptuje nicki z polskimi znakami i bez znaku @', () => {
  const response = buildSexResponse({ message: '!sex Żółw_123', nick: 'Viewer', rng: () => 0.5 });
  assert.match(response, /^@Viewer i @Żółw_123 /);
});

test('!sex odrzuca niepoprawne argumenty i nie przechwytuje podobnych komend', () => {
  assert.equal(buildSexResponse({ message: '!sex @Ala @Olek', nick: 'Viewer' }), 'Użycie: !sex lub !sex @nick');
  assert.equal(buildSexResponse({ message: '!sex @', nick: 'Viewer' }), 'Użycie: !sex lub !sex @nick');
  assert.equal(buildSexResponse({ message: '!sexy @Ala', nick: 'Viewer' }), null);
});
