'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAUSAL_RE,
  normalizujClaim,
  spojnoscTlumaczeniaClaimu,
  wyodrebnijNazwyWlasne,
} = require('../ai/claimValidation');

test('causal translation recognizes triggered as a causal marker', () => {
  assert.equal(CAUSAL_RE.test(normalizujClaim('Wheatley triggered a core transfer.')), true);
});

test('English resistance and Polish odporność share a protection marker', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Możesz również zwiększyć odporność na ogień, mróz lub magię.',
    'You can try increasing your Frost, Fire or magic resistance.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('common sentence-initial Polish nouns from benchmark are not treated as proper names', () => {
  const cases = [
    ['Rodzinne zadanie prowadzi do odnalezienia Anny.', 'rodzinne'],
    ['Polowanie na czarownice jest jednym z powiązanych zadań.', 'polowanie'],
    ['Wędrowanie w ciemności jest kolejnym zadaniem.', 'wedrowanie'],
    ['Struktura generuje się w biomie Netheru.', 'struktura'],
    ['Wiedźmin jest mutowanym łowcą potworów.', 'wiedzmin'],
  ];
  for (const [claim, falseEntity] of cases) {
    assert.equal(wyodrebnijNazwyWlasne(claim).includes(falseEntity), false, claim);
  }
});

test('sentence-initial Polish modifiers are not treated as proper names', () => {
  assert.deepEqual(wyodrebnijNazwyWlasne(
    'Alternatywnymi metodami walki są unieruchamianie smoka lub przyzwanie minionów.',
  ), []);
  assert.deepEqual(wyodrebnijNazwyWlasne(
    'Możesz również zwiększyć odporność na ogień, mróz lub magię.',
  ), []);
});

test('answer coverage checks coordinated factual clauses independently', () => {
  const { sprawdzPokrycieClaimamiOdpowiedzi } = require('../ai/claimValidation');
  const result = sprawdzPokrycieClaimamiOdpowiedzi(
    'Wheatley przejął kontrolę nad Aperture, a potem odnalazł Chell.',
    [{ claim: 'Wheatley przejął kontrolę nad Aperture.' }],
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.uncovered.length > 0, JSON.stringify(result));
});

test('cross-language translation recognizes release and travel concepts without weakening unknown-action rejection', () => {
  const release = spojnoscTlumaczeniaClaimu(
    'Portal 2 został wydany w 2011 roku.',
    'Portal 2 was released in 2011.',
    { evidenceQuote: 'Portal 2 was released in 2011.' },
  );
  assert.equal(release.ok, true, release.reason);
  const travel = spojnoscTlumaczeniaClaimu(
    'Geralt udaje się do Novigradu.',
    'Geralt travels to Novigrad.',
    { evidenceQuote: 'Geralt travels to Novigrad.' },
  );
  assert.equal(travel.ok, true, travel.reason);
});
test('numeric normalization preserves thousands and decimal values across locale formats', () => {
  const { wyodrebnijLiczbyIDaty } = require('../ai/claimValidation');
  assert.deepEqual(wyodrebnijLiczbyIDaty('Około 50,000 lat'), ['50000']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Około 50.000 lat'), ['50000']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Około 50 000 lat'), ['50000']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Wartość wynosi 2,5'), ['2.5']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Wartość wynosi 2.50'), ['2.5']);
});

test('localized Witcher 3 quest titles share verified Polish and English aliases', () => {
  const { KNOWN_ENTITY_ALIAS_PATTERNS } = require('../ai/claimValidation');
  const cases = [
    ['Sprawy rodzinne', 'Family Matters'],
    ['Polowanie na czarownicę', 'Hunting a Witch'],
    ['Wędrowanie w ciemności', 'Wandering in the Dark'],
    ['Damy lasu', 'Ladies of the Wood'],
  ];
  for (const [pl, en] of cases) {
    const alias = KNOWN_ENTITY_ALIAS_PATTERNS.find(entry => entry.pattern.test(pl));
    assert.ok(alias, `missing alias pattern for ${pl}`);
    assert.equal(alias.pattern.test(en), true, `${pl} should match ${en}`);
  }
});
