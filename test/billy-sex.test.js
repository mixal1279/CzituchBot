'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSexResponse } = require('../billy-sex');

test('!sex generuje piekarnicze dopasowanie dla wskazanych osób', () => {
  const response = buildSexResponse({
    message: '!sex @NickInnejOsoby',
    nick: 'Viewer',
    rng: () => 0.97,
  });

  assert.match(response, /^@Viewer i @NickInnejOsoby/);
  assert.match(response, /temperaturę 97%!/);
  assert.match(response, /Piekielna chemia/);
  assert.match(response, /🥖🔥$/);
});

test('!sex obsługuje dolną i górną granicę losowania', () => {
  const zero = buildSexResponse({ message: '!sex @Ala', nick: 'Olek', rng: () => 0 });
  const hundred = buildSexResponse({ message: '!sex @Ala', nick: 'Olek', rng: () => 0.999999 });

  assert.match(zero, /temperaturę 0%!/);
  assert.match(zero, /Zakalcowa relacja/);
  assert.match(hundred, /temperaturę 100%!/);
  assert.match(hundred, /MIŁOŚĆ WYPIEKANA/);
});

test('!sex wymaga jednego nicku i nie przechwytuje podobnych komend', () => {
  assert.equal(buildSexResponse({ message: '!sex', nick: 'Viewer' }), 'Użycie: !sex @nick');
  assert.equal(buildSexResponse({ message: '!sex @Ala @Olek', nick: 'Viewer' }), 'Użycie: !sex @nick');
  assert.equal(buildSexResponse({ message: '!sexy @Ala', nick: 'Viewer' }), null);
});
