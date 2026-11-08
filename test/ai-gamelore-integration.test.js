'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { wyodrebnijJawnyTytulGry } = require('../ai/entities');
const { wytnijAtrybucjeGameLore, wytnijAtrybucjeGameLoreWszystkie } = require('../ai/lore');

test('jawny tytuł gry po „w grze” nie wymaga wielkich liter', () => {
  assert.equal(wyodrebnijJawnyTytulGry('W grze stardew valley kim jest Abigail?'), 'stardew valley');
  assert.equal(wyodrebnijJawnyTytulGry('w grze hades: kim jest Zagreus?'), 'hades');
  assert.equal(wyodrebnijJawnyTytulGry('W grze red dead redemption 2, dlaczego Arthur zachorował?'), 'red dead redemption 2');
  assert.equal(wyodrebnijJawnyTytulGry('W grze „unknown title” opisz głównego bohatera.'), 'unknown title');
  assert.equal(wyodrebnijJawnyTytulGry('W grze: kim jest bohater?'), null);
  assert.equal(wyodrebnijJawnyTytulGry('W filmie Stardew Valley: kim jest Abigail?'), null);
});

test('atrybucja GameLore wybiera dokładnie wskazane SOURCE ID', () => {
  const evidence = [
    '[SOURCE 1]',
    'TYTUŁ: Niepowiązany poradnik',
    'HOST: ign.com',
    'URL: https://www.ign.com/articles/example',
    'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
    'Treść źródła.',
    '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
    '[SOURCE 2]',
    'TYTUŁ: Abigail — Stardew Valley Wiki',
    'HOST: gamelore.fandom.com',
    'URL: https://gamelore.fandom.com/wiki/Abigail',
    'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
    'Abigail is a villager in Stardew Valley.',
    '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
  ].join('\n');

  assert.equal(wytnijAtrybucjeGameLore(evidence, new Set(['SOURCE 1'])), null);
  assert.deepEqual(wytnijAtrybucjeGameLore(evidence, new Set(['SOURCE 2'])), {
    sourceId: 'SOURCE 2',
    name: 'GameLore Wiki',
    title: 'Abigail — Stardew Valley Wiki',
    url: 'https://gamelore.fandom.com/wiki/Abigail',
    license: 'CC BY-SA',
  });
});

test('atrybucja obejmuje wszystkie zaakceptowane źródła GameLore bez duplikatów', () => {
  const block = (id, slug, title) => [
    '[SOURCE ' + id + ']',
    'TYTUŁ: ' + title,
    'HOST: gamelore.fandom.com',
    'URL: https://gamelore.fandom.com/wiki/' + slug,
    'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
    'Treść wiki.',
    '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
  ].join('\n');
  const evidence = [
    block(1, 'Abigail', 'Abigail'),
    block(2, 'Sebastian', 'Sebastian'),
    block(3, 'Abigail', 'Abigail — duplikat'),
  ].join('\n');
  const results = wytnijAtrybucjeGameLoreWszystkie(evidence, new Set(['SOURCE 1', 'SOURCE 2', 'SOURCE 3']));
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(item => item.url), [
    'https://gamelore.fandom.com/wiki/Abigail',
    'https://gamelore.fandom.com/wiki/Sebastian',
  ]);
  assert.equal(wytnijAtrybucjeGameLore(evidence, new Set(['SOURCE 2'])).sourceId, 'SOURCE 2');
});

test('atrybucja odrzuca podszywający się host i niezabezpieczony URL', () => {
  const makeEvidence = (host, url) => [
    '[SOURCE 1]',
    'TYTUŁ: Test',
    'HOST: ' + host,
    'URL: ' + url,
    'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
    'Treść.',
    '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
  ].join('\n');

  assert.equal(
    wytnijAtrybucjeGameLore(makeEvidence('gamelore.fandom.com.evil.test', 'https://gamelore.fandom.com.evil.test/wiki/Test'), new Set(['SOURCE 1'])),
    null,
  );
  assert.equal(
    wytnijAtrybucjeGameLore(makeEvidence('gamelore.fandom.com', 'http://gamelore.fandom.com/wiki/Test'), new Set(['SOURCE 1'])),
    null,
  );
});

test('główny pipeline publikuje atrybucję dopiero po walidacji claimów', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');
  const finalizeIndex = source.indexOf('odp = finalizeResponse(odp, aiState.finalStatus);');
  const attributionIndex = source.indexOf('wytnijAtrybucjeGameLore(daneDoWalidacji, zweryfikowaneZrodlaIds)');
  assert.ok(finalizeIndex >= 0);
  assert.ok(attributionIndex > finalizeIndex);
  assert.ok(source.includes("claim?.supported === true"));
});
