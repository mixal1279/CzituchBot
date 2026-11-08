'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  wyodrebnijNazwyWlasne,
  sprawdzTwardeKonflikty,
  czyOgraniczenieDowodowe,
} = require('../ai/claimValidation');
const { sourceMatchesRequestContext, wykryjJezykTekstu, sourceLanguageCompatible, normalizeSource } = require('../ai/core');

test('repozytoryjne aliasy encji rozpoznają postacie i tytuły bez czarnej listy', () => {
  assert.ok(wyodrebnijNazwyWlasne('Wheatley przejął kontrolę w Portal 2.').includes('wheatley'));
  assert.ok(wyodrebnijNazwyWlasne('Skyrim ma rozbudowany świat.').includes('skyrim'));
  const ordinary = wyodrebnijNazwyWlasne('Zarówno średni czas, jak i pełni funkcję pomocniczą.');
  assert.equal(ordinary.includes('zarowno'), false);
  assert.equal(ordinary.includes('sredni'), false);
  assert.equal(ordinary.includes('pelni'), false);
});

test('alias w nawiasie po rozpoznanej encji nie tworzy osobnych nazw własnych', () => {
  const names = wyodrebnijNazwyWlasne('Wheatley jest osobowościowym rdzeniem (Intelligence Dampening Sphere) w Portal 2.');
  assert.ok(names.includes('wheatley'));
  assert.equal(names.includes('intelligence'), false);
  assert.equal(names.includes('dampening'), false);
  assert.equal(names.includes('sphere'), false);
});

test('twierdzenie o braku informacji w źródłach nie jest konfliktem polaryzacji', () => {
  const claim = 'Źródła nie podają, co stało się z Vesemirem w grze The Witcher 3.';
  assert.equal(czyOgraniczenieDowodowe(claim), true);
  const result = sprawdzTwardeKonflikty('The Witcher: Vesemir Explained - Who Is Geralt\'s Mentor in Season 2', claim);
  assert.equal(result.ok, true);
});

test('filtr encji działa dla web_fact o postaci, nie tylko dla lore/gameplay', () => {
  const routing = {
    intent: 'web_fact',
    entity_type: 'character',
    entity: 'Vesemir',
    game: 'The Witcher 3: Wild Hunt',
    resolved_entity: { type: 'character', name: 'Vesemir', game: 'The Witcher 3: Wild Hunt' },
  };
  assert.equal(sourceMatchesRequestContext({ title: 'Vesemir Explained - Netflix Season 2', content: 'Vesemir in the Netflix series.' }, routing), false);
  assert.equal(sourceMatchesRequestContext({ title: 'Vesemir | The Witcher 3', content: 'Vesemir appears in The Witcher 3: Wild Hunt.' }, routing), true);
});

test('rozpoznawanie języka odrzuca mocny sygnał portugalski dla polskiego pytania', () => {
  const pt = 'Alex é uma das nove skins padrão de jogador no Minecraft. Ela está disponível para todos os jogadores.';
  assert.equal(wykryjJezykTekstu(pt).language, 'pt');
  assert.equal(sourceLanguageCompatible({ title: 'Alex', content: pt }, 'Kim jest Alex w Minecraft?'), false);
  assert.equal(sourceLanguageCompatible({ title: 'Alex Minecraft', content: 'Alex is one of the nine default player skins in Minecraft.' }, 'Kim jest Alex w Minecraft?'), true);
});


test('normalizacja źródła usuwa nawigację MediaWiki i surowe znaczniki infoboxu', () => {
  const source = normalizeSource({
    title: 'Alex',
    url: 'https://minecraft.wiki/w/Alex',
    content: '[Jump to navigation](#mw-head) [Jump to search](#searchInput) { "title": "Alex", "rows": [{ "field": "Allies", "label": "Aliados" }] } Alex é uma das nove skins padrão de jogador no Minecraft.',
  });
  assert.doesNotMatch(source.content, /Jump to navigation|searchInput|\"rows\"|\"title\"/i);
  assert.match(source.content, /Alex é uma das nove skins/);
});