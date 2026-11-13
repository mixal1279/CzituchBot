'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  wyodrebnijNazwyWlasne,
  sprawdzTwardeKonflikty,
  czyOgraniczenieDowodowe,
  spojnoscTlumaczeniaClaimu,
  czyCzesciowaOdpowiedzMaKotwiceEncji,
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

test('ograniczenie epistemiczne modelu nie jest konfliktem negacji ze źródłem', () => {
  const claims = [
    'Model stwierdza, że nie posiada wystarczających danych, aby określić lokalizację Wielkiego Miecza.',
    'Nie posiadam wystarczających danych, aby określić, gdzie znajduje się Wielki Miecz.',
    'Dostępne dane referencyjne nie zawierają informacji o lokalizacji Wielkiego Miecza.',
  ];
  for (const claim of claims) {
    assert.equal(czyOgraniczenieDowodowe(claim), true, claim);
    assert.equal(
      sprawdzTwardeKonflikty('Elden Ring map fragments guide – Where to find map fragments in each region', claim).ok,
      true,
      claim,
    );
  }
  assert.equal(czyOgraniczenieDowodowe('Wielki Miecz nie znajduje się w Caelid.'), false);
});

test('detektor języka rozpoznaje krótkie polskie pytanie z diakrytykami i blokuje źródło portugalskie', () => {
  const question = 'W grze Minecraft: Czym różni się Steve od Alex?';
  const pt = 'Alex é uma das nove skins padrão de jogador no Minecraft, e a segunda a ser introduzida.';
  assert.equal(wykryjJezykTekstu(question).language, 'pl');
  assert.equal(sourceLanguageCompatible({ title: 'Alex', content: pt }, question), false);
  assert.equal(sourceLanguageCompatible({ title: 'Alex', content: pt }, question, { language: 'unknown' }), false);
  assert.equal(sourceLanguageCompatible({ title: 'Alex', content: 'Alex is one of the nine default player skins in Minecraft.' }, question), true);
});

test('tłumaczenie „the character” może odziedziczyć jednoznaczną postać z poprzedniego zdania źródła', () => {
  const claimPl = 'Steve pojawił się w 2009 roku w Zombie Town.';
  const claimEn = 'The character originated from Zombie Town, an unreleased game developed by Notch in 2009.';
  const quote = 'O personagem surgiu de Zombie Town, um jogo inédito desenvolvido por Notch em 2009';
  const context = '**Steve** é uma das nove skins padrão de jogador no Minecraft e a primeira a ser introduzida. O personagem surgiu de Zombie Town, um jogo inédito desenvolvido por Notch em 2009.';
  const result = spojnoscTlumaczeniaClaimu(claimPl, claimEn, {
    evidenceQuote: quote,
    evidenceContext: context,
  });
  assert.equal(result.ok, true, JSON.stringify(result));

  const ambiguousContext = 'Steve e Alex são skins padrão de jogador no Minecraft. O personagem surgiu de Zombie Town, um jogo inédito desenvolvido por Notch em 2009.';
  const ambiguous = spojnoscTlumaczeniaClaimu(claimPl, claimEn, {
    evidenceQuote: quote,
    evidenceContext: ambiguousContext,
  });
  assert.equal(ambiguous.ok, false);
});


test('częściowa odpowiedź o postaci musi zachować nazwę postaci z pytania', () => {
  const question = 'Kim jest Johnny Silverhand w Cyberpunk 2077?';
  assert.equal(
    czyCzesciowaOdpowiedzMaKotwiceEncji(question, 'Jest także rewolucjonistą i ikoną Night City.'),
    false,
  );
  assert.equal(
    czyCzesciowaOdpowiedzMaKotwiceEncji(question, 'Johnny Silverhand jest rewolucjonistą i ikoną Night City.'),
    true,
  );
  assert.equal(
    czyCzesciowaOdpowiedzMaKotwiceEncji('Czy warto zagrać w tę grę?', 'To dobra gra RPG.'),
    true,
  );
});


test('filtr źródeł odzyskuje postać z pytania, gdy router zwrócił tytuł gry jako entity', () => {
  const routing = {
    intent: 'web_fact',
    entity_type: 'character',
    entity: 'The Witcher 3: Wild Hunt',
    game: 'The Witcher 3: Wild Hunt',
    resolved_entity: { type: 'game', name: 'The Witcher 3: Wild Hunt' },
  };
  const question = 'W grze The Witcher 3: Co stało się z Vesemir?';
  assert.equal(sourceMatchesRequestContext({
    title: 'Vesemir Explained - Netflix Season 2',
    content: 'Vesemir appears in the Netflix series The Witcher.',
  }, routing, question), false);
  assert.equal(sourceMatchesRequestContext({
    title: 'Vesemir | The Witcher 3',
    content: 'Vesemir appears in The Witcher 3: Wild Hunt.',
  }, routing, question), true);

  const relationshipQuestion = 'W grze The Witcher 3: Jaka jest relacja między Geraltem a Ciri?';
  assert.equal(sourceMatchesRequestContext({
    title: 'Geralt | The Witcher 3',
    content: 'Geralt appears in The Witcher 3: Wild Hunt.',
  }, routing, relationshipQuestion), false);
  assert.equal(sourceMatchesRequestContext({
    title: 'Geralt and Ciri | The Witcher 3',
    content: 'Geralt and Ciri have a father-daughter relationship in The Witcher 3: Wild Hunt.',
  }, routing, relationshipQuestion), true);
});
