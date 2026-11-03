'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSexResponse } = require('../billy-sex');

test('!sex generuje piekarnicze dopasowanie dla wskazanych osób', () => {
  const response = buildSexResponse({ message: '!sex @NickInnejOsoby', nick: 'Viewer', rng: () => 0.97 });
  assert.match(response, /^@Viewer i @NickInnejOsoby/);
  assert.match(response, /temperaturę 97%!/);
  assert.match(response, /chrupiąca kajzerka z ciepłym masełkiem/);
  assert.match(response, /Piekielna chemia/);
  assert.match(response, /🥖🔥$/);
});

test('!sex bez celu losuje piekarniczą ocenę dla samego użytkownika', () => {
  const response = buildSexResponse({ message: '!sex', nick: 'Viewer', rng: () => 0.42 });
  assert.match(response, /^@Viewer – Twoja piekarnicza forma/);
  assert.match(response, /42%!/);
  assert.match(response, /Bułeczka powoli się dopieka/);
  assert.match(response, /🥖🔥$/);
});

test('!sex obsługuje dolną i górną granicę losowania w obu wariantach', () => {
  const zero = buildSexResponse({ message: '!sex @Ala', nick: 'Olek', rng: () => 0 });
  const hundred = buildSexResponse({ message: '!sex', nick: 'Olek', rng: () => 0.999999 });
  assert.match(zero, /temperaturę 0%!/);
  assert.match(zero, /Zakalcowa relacja/);
  assert.match(hundred, /100%!/);
  assert.match(hundred, /MIŁOŚĆ WYPIEKANA/);
});

test('!sex odrzuca niepoprawne argumenty i nie przechwytuje podobnych komend', () => {
  assert.equal(buildSexResponse({ message: '!sex @Ala @Olek', nick: 'Viewer' }), 'Użycie: !sex lub !sex @nick');
  assert.equal(buildSexResponse({ message: '!sex @', nick: 'Viewer' }), 'Użycie: !sex lub !sex @nick');
  assert.equal(buildSexResponse({ message: '!sexy @Ala', nick: 'Viewer' }), null);
});
