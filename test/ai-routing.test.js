'use strict';

const assert = require('node:assert/strict');
const { classifyAIRequest } = require('../ai/router');
const { planAIRequest, buildRetrievalQueries } = require('../ai/planner');
const { okreslKategorieAI } = require('../ai/policy');
const { dodajGameFAQsDomenę, czyPytanieOGameplay } = require('../ai/gameplay');

const policy = (q, recipe) => {
  if (/czy warto|co myślisz|co sadzisz|opinia/i.test(q)) return 'conversation';
  if (recipe(q)) return 'minecraft_recipe';
  if (/pogod|temperatur|deszcz|wiatr/i.test(q)) return 'weather';
  if (/ile trwa|jak długo.*gry|hltb/i.test(q)) return 'hltb';
  if (/youtube|kanał|subskryb|streamer|twitch|kick/i.test(q)) return 'youtube';
  if (/dzisiaj|najnowsz|aktualn|news/i.test(q)) return 'web_fact';
  if (/jak|gdzie|kto|kim|co|dlaczego|kiedy|ile|czy/i.test(q)) return 'web_fact';
  return 'conversation';
};

const astarionQueries = buildRetrievalQueries('Dlaczego Astarion dołączył do drużyny?', {
  needs_web: true,
  is_lore: true,
  is_gameplay: false,
  entity: 'Astarion',
  game: 'Baldur’s Gate 3',
  resolved_entity: { name: 'Astarion', game: 'Baldur’s Gate 3' },
}, { maxQueries: 4 });
assert.ok(astarionQueries.some(query => /motivation|backstory|antagonist|escape/i.test(query)));

const cases = [
  ['Kim jest Wheatley w Portal 2?', 'lore', 'Portal 2', 'character'],
  ['Dlaczego GLaDOS została pokonana?', 'lore', 'Portal', 'character'],
  ['Dlaczego Arthur zdradził Dutchowi?', 'lore', 'Red Dead Redemption 2', 'character'],
  ['Kim jest Johnny Silverhand?', 'lore', 'Cyberpunk 2077', 'character'],
  ['Kim jest Geralt?', 'lore', 'The Witcher 3: Wild Hunt', 'character'],
  ['Kim jest Ciri?', 'lore', 'The Witcher 3: Wild Hunt', 'character'],
  ['Dlaczego Kratos walczy z bogami?', 'lore', 'God of War', 'character'],
  ['Kim jest Ellie?', 'lore', 'The Last of Us', 'character'],
  ['Historia świata Elden Ring', 'lore', 'Elden Ring', 'game'],
  ['Historia Cyberpunka 2077', 'lore', 'Cyberpunk 2077', 'game'],
  ['Timeline Fallouta', 'timeline', 'Fallout', 'franchise'],
  ['Jak pokonać bossa w Portal 2?', 'gameplay', 'Portal 2', 'game'],
  ['Jak znaleźć sekret w Wiedźminie 3?', 'gameplay', 'The Witcher 3: Wild Hunt', 'game'],
  ['Jak zdobyć broń w Cyberpunk 2077?', 'gameplay', 'Cyberpunk 2077', 'game'],
  ['Gdzie znaleźć przedmiot w Elden Ring?', 'gameplay', 'Elden Ring', 'game'],
  ['Jak przejść questa w Red Dead Redemption 2?', 'gameplay', 'Red Dead Redemption 2', 'game'],
  ['Jak zrobić miecz diamentowy w Minecraft?', 'minecraft_recipe', 'Minecraft', 'game'],
  ['Ile trwa Cyberpunk 2077?', 'hltb', 'Cyberpunk 2077', 'game'],
  ['Ile trwa Elden Ring?', 'hltb', 'Elden Ring', 'game'],
  ['Ile trwa Red Dead Redemption 2?', 'hltb', 'Red Dead Redemption 2', 'game'],
  ['Jaka jest dzisiaj pogoda?', 'weather', null, null],
  ['Jaka jest najnowsza wersja Minecrafta?', 'web_fact', 'Minecraft', 'game'],
  ['Co nowego dzisiaj w Fortnite?', 'web_fact', 'Fortnite', 'game'],
  ['Ile subów ma ten kanał YouTube?', 'youtube', 'YouTube', 'entity'],
  ['Kim jest ten streamer na Twitchu?', 'youtube', 'Twitch', 'entity'],
  ['Czy warto kupić tę grę?', 'conversation', null, null],
  ['Co myślisz o tej grze?', 'conversation', null, null],
];

for (const [question, expectedIntent, expectedEntity, expectedType] of cases) {
  const routing = classifyAIRequest(question, policy, q => /minecraft.*zrobić|zrobić.*minecraft/i.test(q));
  const plan = planAIRequest(question, routing);

  if (expectedIntent === 'timeline') {
    assert.equal(routing.is_lore, true, question);
    assert.equal(routing.needs_web, true, question);
    assert.equal(plan.responseProfile, 'timeline', question);
  } else if (expectedIntent === 'lore') {
    assert.equal(routing.is_lore, true, question);
    assert.equal(routing.needs_web, true, question);
    assert.equal(plan.responseProfile, 'lore', question);
  } else if (expectedIntent === 'gameplay') {
    assert.equal(routing.is_gameplay, true, question);
    assert.equal(routing.needs_web, true, question);
    assert.equal(plan.responseProfile, 'gameplay', question);
  } else {
    assert.equal(routing.intent, expectedIntent, question);
  }

  if (expectedEntity) assert.equal(routing.entity, expectedEntity, question);
  if (expectedType) assert.equal(routing.entity_type, expectedType, question);
}

const selectedDomains = dodajGameFAQsDomenę(['youtube.com', 'example.com']);
assert.deepEqual(selectedDomains, ['youtube.com', 'example.com']);
assert.deepEqual(dodajGameFAQsDomenę(['gamefaqs.gamespot.com']), ['gamefaqs.gamespot.com']);
assert.equal(czyPytanieOGameplay('Jak odblokować ten sekret?', ['unrelated.fandom.com']), false);
assert.equal(czyPytanieOGameplay('Jak odblokować ten sekret?', ['gamelore.fandom.com']), true);

for (const question of [
  'Ile trwa fight w Elden Ring?',
  'Ile trwa update Cyberpunka 2077?',
  'Ile trwa download GTA 5?',
]) {
  const routing = classifyAIRequest(question, okreslKategorieAI);
  assert.notEqual(routing.intent, 'hltb', question);
  assert.equal(routing.needs_web, true, question);
}

// Tytuły gier są pobierane z centralnej tabeli aliasów, nie z osobnej listy regexów.
for (const question of [
  'Kim jest Lilith w Diablo IV?',
  'Jak pokonać bossa w Diablo 4?',
  'Historia serii Diablo',
  'Kim jest Ezio w Assassin’s Creed?',
]) {
  const routing = classifyAIRequest(question, okreslKategorieAI);
  assert.equal(routing.needs_web, true, question);
  assert.notEqual(routing.intent, 'conversation', question);
}

// Pytanie opiniotwórcze o konkretną grę nie może wyłączać retrieval.
const gameOpinion = classifyAIRequest('Czy warto kupić Diablo IV?', okreslKategorieAI);
assert.equal(gameOpinion.needs_web, true);
assert.equal(gameOpinion.intent, 'web_fact');

// Ogólny small talk nadal nie uruchamia wyszukiwania.
const genericOpinion = classifyAIRequest('Co myślisz o tej grze?', okreslKategorieAI);
assert.equal(genericOpinion.needs_web, false);
assert.equal(genericOpinion.intent, 'conversation');

console.log('AI routing benchmark: OK');


 
const astarionWhyQueries = buildRetrievalQueries('Dlaczego Astarion dołączył do drużyny?', {
  needs_web: true, is_lore: true, entity: 'Astarion', game: "Baldur's Gate 3",
}, { maxQueries: 4 });
assert.ok(astarionWhyQueries.some(query => /Cazador.*vampire spawn.*escape/i.test(query)));

const dragonbornWhoQueries = buildRetrievalQueries('Kim jest Dragonborn?', {
  needs_web: true, is_lore: true, entity: 'Dragonborn', game: 'Skyrim',
}, { maxQueries: 4 });
assert.ok(dragonbornWhoQueries.some(query => /Dovahkiin.*last Dragonborn.*prophecy/i.test(query)));

const trevorWhenQueries = buildRetrievalQueries('Kiedy Michael poznaje Trevora?', {
  needs_web: true, entity: 'Michael', game: 'GTA V',
}, { maxQueries: 4 });
assert.ok(trevorWhenQueries.some(query => /Fame or Shame.*Prologue/i.test(query)));

const elytraHowQueries = buildRetrievalQueries('Jak zdobyć elytrę?', {
  needs_web: true, is_gameplay: true, entity: 'Minecraft', game: 'Minecraft',
}, { maxQueries: 4 });
assert.ok(elytraHowQueries.some(query => /elytra obtain Survival mode End ship/i.test(query)), JSON.stringify(elytraHowQueries));


// Firmy i marki nie mogą być klasyfikowane jako gry tylko przez podobną nazwę.
const diabloChairs = classifyAIRequest('Czy warto kupić fotel Diablo Chairs?', okreslKategorieAI);
assert.equal(diabloChairs.intent, 'web_fact');
assert.equal(diabloChairs.needs_web, true);
assert.equal(diabloChairs.entity, 'Diablo Chairs');
assert.equal(diabloChairs.entity_type, 'company');
assert.equal(diabloChairs.game, null);
assert.equal(diabloChairs.company, 'Diablo Chairs');

const diabloGame = classifyAIRequest('Jak pokonać bossa w Diablo IV?', okreslKategorieAI);
assert.equal(diabloGame.entity, 'Diablo IV');
assert.equal(diabloGame.entity_type, 'game');
assert.equal(diabloGame.game, 'Diablo IV');

const genericCompany = classifyAIRequest('Czym zajmuje się firma TSMC?', okreslKategorieAI);
assert.equal(genericCompany.intent, 'web_fact');
assert.equal(genericCompany.entity, 'TSMC');
assert.equal(genericCompany.entity_type, 'company');
assert.equal(genericCompany.game, null);

const unknownCompany = classifyAIRequest('Co produkuje firma Acme Robotics?', okreslKategorieAI);
assert.equal(unknownCompany.intent, 'web_fact');
assert.equal(unknownCompany.needs_web, true);
assert.equal(unknownCompany.entity_type, 'company');
assert.equal(unknownCompany.game, null);

const unknownCompanyInflected = classifyAIRequest('Co wiesz o firmie Acme Robotics?', okreslKategorieAI);
assert.equal(unknownCompanyInflected.entity_type, 'company');
assert.equal(unknownCompanyInflected.needs_web, true);

const companyOpinion = classifyAIRequest('Co sądzisz o Diablo Chairs?', okreslKategorieAI);
assert.equal(companyOpinion.intent, 'web_fact');
assert.equal(companyOpinion.needs_web, true);
assert.equal(companyOpinion.entity_type, 'company');

const unknownCompanyOpinion = classifyAIRequest('Co sądzisz o firmie Acme Robotics?', okreslKategorieAI);
assert.equal(unknownCompanyOpinion.intent, 'web_fact');
assert.equal(unknownCompanyOpinion.needs_web, true);
assert.equal(unknownCompanyOpinion.entity_type, 'company');
