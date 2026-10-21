'use strict';
// Dwie tabele aliasów: dane (ai/entityAliases.js) i legacy regexy
// (KNOWN_ENTITY_ALIAS_PATTERNS w ai/claimValidation.js) są scalane po nazwie
// kanonicznej. Test pilnuje, żeby scalenie niczego nie gubiło i żeby każda
// grupa rozpoznawała wszystkie swoje nazwy.
const test = require('node:test');
const assert = require('node:assert');

const { ENTITY_ALIAS_GROUPS } = require('../ai/entityAliases');
const { KNOWN_ENTITY_ALIAS_PATTERNS, wyodrebnijNazwyWlasne } = require('../ai/claimValidation');

test('każda grupa z tabeli danych ma wpis w scalonej tabeli aliasów', () => {
  const known = new Map(KNOWN_ENTITY_ALIAS_PATTERNS.map(item => [item.canonical, item.pattern]));
  for (const group of ENTITY_ALIAS_GROUPS) {
    const canonical = group.canonical.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    assert.ok(known.has(canonical), `brak aliasu dla ${group.canonical}`);
  }
});

test('wzorzec aliasu rozpoznaje wszystkie nazwy swojej grupy', () => {
  const known = new Map(KNOWN_ENTITY_ALIAS_PATTERNS.map(item => [item.canonical, item.pattern]));
  for (const group of ENTITY_ALIAS_GROUPS) {
    const canonical = group.canonical.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const pattern = known.get(canonical);
    for (const name of group.names) {
      assert.ok(pattern.test(name), `${group.canonical}: wzorzec nie rozpoznaje „${name}”`);
    }
  }
});

test('nazwa z grupy aliasowej jest wyciągana jako nazwa kanoniczna', () => {
  // Wyciąganie nazwy ma zwracać formę kanoniczną — inaczej rozstrzyganie
  // „tłumaczone czy wymyślone” nie działałoby dla nazw przetłumaczonych.
  const extracted = wyodrebnijNazwyWlasne('Wheatley przejmuje kontrolę nad Katedry Smoczej Komunii.');
  assert.ok(
    extracted.some(name => name === 'cathedral of dragon communion'),
    `oczekiwano nazwy kanonicznej, otrzymano: ${JSON.stringify(extracted)}`,
  );
});
