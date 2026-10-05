'use strict';

const assert = require('node:assert/strict');
const { classifyAIRequest } = require('../ai/router');
const { planAIRequest } = require('../ai/planner');

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

console.log('AI routing benchmark: OK');
