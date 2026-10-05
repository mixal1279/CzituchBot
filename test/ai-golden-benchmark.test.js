'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classifyAIRequest } = require('../ai/router');
const { planAIRequest } = require('../ai/planner');

const policy = (q, recipe) => {
  if (/czy warto|co myślisz|co sadzisz|opinia/i.test(q)) return 'conversation';
  if (recipe?.(q)) return 'minecraft_recipe';
  if (/pogoda|temperatur|deszcz|wiatr/i.test(q)) return 'weather';
  if (/ile trwa|jak długo.*gry|hltb/i.test(q)) return 'hltb';
  if (/youtube|kanał|subskryb|streamer|twitch|kick/i.test(q)) return 'youtube';
  if (/dzisiaj|najnowsz|aktualn|news/i.test(q)) return 'web_fact';
  if (/jak|gdzie|kto|kim|co|dlaczego|kiedy|ile|czy/i.test(q)) return 'web_fact';
  return 'conversation';
};

const games = [
  ['Minecraft'], ['Portal 2'], ['Cyberpunk 2077'], ['The Witcher 3'],
  ['Red Dead Redemption 2'], ['GTA V'], ['Elden Ring'], ['Dark Souls'],
  ['Baldur’s Gate 3'], ['The Last of Us'], ['God of War'], ['Fallout 4'],
  ['Skyrim'], ['Starfield'], ['Fortnite'],
];

const cases = [];
for (const [game] of games) {
  cases.push([`Historia fabuły ${game}`, 'lore', game]);
  cases.push([`Jak przejść questa w ${game}?`, 'gameplay', game]);
  cases.push([`Ile trwa ${game}?`, 'hltb', game]);
  cases.push([`Co nowego dzisiaj w ${game}?`, 'web_fact', game]);
  cases.push([`Czy warto kupić ${game}?`, 'conversation', game]);
}

const edgeCases = [
  ['Kim jest Wheatley w Portal 2?', 'lore', 'Portal 2'],
  ['Dlaczego GLaDOS przegrała w Portal 2?', 'lore', 'Portal 2'],
  ['Kim jest Arthur Morgan w Red Dead Redemption 2?', 'lore', 'Red Dead Redemption 2'],
  ['Dlaczego Arthur zachorował na gruźlicę w RDR2?', 'lore', 'Red Dead Redemption 2'],
  ['Kim jest Johnny Silverhand w Cyberpunku 2077?', 'lore', 'Cyberpunk 2077'],
  ['Kim jest Geralt w Wiedźminie 3?', 'lore', 'The Witcher 3'],
  ['Kim jest Ciri w Wiedźminie 3?', 'lore', 'The Witcher 3'],
  ['Dlaczego Kratos walczy z bogami?', 'lore', 'God of War'],
  ['Kim jest Ellie w The Last of Us?', 'lore', 'The Last of Us'],
  ['Historia świata Elden Ring', 'lore', 'Elden Ring'],
  ['Jak znaleźć sekret w Wiedźminie 3?', 'gameplay', 'The Witcher 3'],
  ['Jak zdobyć broń w Cyberpunku 2077?', 'gameplay', 'Cyberpunk 2077'],
  ['Gdzie znaleźć przedmiot w Elden Ring?', 'gameplay', 'Elden Ring'],
  ['Jak pokonać bossa w Dark Souls?', 'gameplay', 'Dark Souls'],
  ['Jak przejść questa w RDR2?', 'gameplay', 'Red Dead Redemption 2'],
  ['Ile godzin ma Cyberpunka 2077?', 'hltb', 'Cyberpunk 2077'],
  ['Jak długo trwa przejście Elden Ring?', 'hltb', 'Elden Ring'],
  ['Czas przejścia Red Dead Redemption 2?', 'hltb', 'Red Dead Redemption 2'],
  ['Jaka jest najnowsza wersja Minecrafta?', 'web_fact', 'Minecraft'],
  ['Co nowego dzisiaj w Fortnite?', 'web_fact', 'Fortnite'],
  ['Co myślisz o Cyberpunku 2077?', 'conversation', 'Cyberpunk 2077'],
  ['Czy warto kupić Elden Ring?', 'conversation', 'Elden Ring'],
  ['Czy warto kupić Portal 2?', 'conversation', 'Portal 2'],
  ['Co sądzisz o Wiedźminie 3?', 'conversation', 'The Witcher 3'],
  ['Czy GTA V jest nadal dobre?', 'conversation', 'GTA V'],
];
cases.push(...edgeCases);
assert.equal(cases.length, 100, 'Benchmark musi mieć dokładnie 100 przypadków.');

test('AI golden routing benchmark — 100 przypadków', () => {
  const failures = [];
  for (const [question, expectedIntent] of cases) {
    const routing = classifyAIRequest(question, policy);
    const plan = planAIRequest(question, routing);
    let ok = true;
    if (expectedIntent === 'lore') ok = routing.is_lore === true && routing.needs_web === true && plan.responseProfile === 'lore';
    else if (expectedIntent === 'gameplay') ok = routing.is_gameplay === true && routing.needs_web === true && plan.responseProfile === 'gameplay';
    else ok = routing.intent === expectedIntent;
    if (!ok) failures.push({ question, expectedIntent, actualIntent:routing.intent, lore:routing.is_lore, gameplay:routing.is_gameplay, entity:routing.entity, game:routing.game, profile:plan.responseProfile });
  }
  assert.deepEqual(failures, [], `Routing benchmark failures: ${JSON.stringify(failures, null, 2)}`);
});

test('AI hardening — Arthur Morgan nie miesza się z Cyberpunkiem', () => {
  const routing = classifyAIRequest('Dlaczego Arthur Morgan zachorował na gruźlicę w Red Dead Redemption 2?', policy);
  assert.equal(routing.entity, 'Red Dead Redemption 2');
  assert.equal(routing.game, 'Red Dead Redemption 2');
  assert.equal(routing.entity_type, 'character');
});

test('AI hardening — odmiana polska Cyberpunka zachowuje encję gry', () => {
  const routing = classifyAIRequest('Historia Cyberpunka 2077', policy);
  assert.equal(routing.entity, 'Cyberpunk 2077');
  assert.equal(routing.game, 'Cyberpunk 2077');
  assert.equal(routing.is_lore, true);
});

console.log('AI golden benchmark: 100/100 przypadków zdefiniowanych.');