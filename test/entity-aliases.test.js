'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ENTITY_ALIAS_GROUPS, buildAliasPattern, buildEntityAliasPatterns } = require('../ai/entityAliases');
const {
  KNOWN_ENTITY_ALIAS_PATTERNS,
  wyodrebnijNazwyWlasne,
  dopasowanieSemantyczne,
  spojnoscTlumaczeniaClaimu,
} = require('../ai/claimValidation');

// Syntetyczna grupa: test sprawdza mechanizm, nie prawdziwe tłumaczenia z gier.
const GROUP = { canonical: 'zeta keep', names: ['Zeta Keep', 'Twierdza Zeta'] };

function withGroup(fn) {
  const entries = buildEntityAliasPatterns([GROUP]);
  KNOWN_ENTITY_ALIAS_PATTERNS.push(...entries);
  try { return fn(); } finally { KNOWN_ENTITY_ALIAS_PATTERNS.splice(KNOWN_ENTITY_ALIAS_PATTERNS.length - entries.length, entries.length); }
}

test('wzorzec aliasu łapie odmianę i brak polskich znaków', () => {
  const pattern = buildAliasPattern(['Greatsword', 'Wielki Miecz']);
  assert.ok(pattern.test('Gracz znalazł Wielkiego Miecza w skrzyni.'));
  assert.ok(pattern.test('wielkiego miecza'));
  assert.ok(pattern.test('The Greatsword is rare.'));
  assert.equal(pattern.test('Wielki Mieczyk'), false);
  assert.equal(pattern.test('Great sword'), false);
});

test('alias z tabeli jest jedną encją, a polska nazwa pasuje do angielskiego źródła', () => withGroup(() => {
  const claim = 'Gracz znajdzie Twierdzę Zeta na północy.';
  assert.deepEqual(wyodrebnijNazwyWlasne(claim), ['zeta keep']);
  const ok = dopasowanieSemantyczne('The player finds Zeta Keep in the north.', claim);
  assert.notEqual(ok.reason, 'dowód nie zawiera wszystkich istotnych nazw własnych claimu');
}));

test('wymyślona nazwa nieobecna w dowodzie nadal powoduje odrzucenie', () => withGroup(() => {
  const res = dopasowanieSemantyczne('The player finds Zeta Keep in the north.', 'Gracz znajdzie Twierdzę Omega na północy.');
  assert.equal(res.ok, false);
  assert.match(res.reason, /nazw własnych/);
}));

test('produkcyjne aliasy PL/EN normalizują znane encje do jednego kanonicznego identyfikatora', () => {
  assert.ok(KNOWN_ENTITY_ALIAS_PATTERNS.some(entry => entry.canonical === 'wild hunt'));
  assert.ok(KNOWN_ENTITY_ALIAS_PATTERNS.some(entry => entry.canonical === 'bloody baron'));
  assert.deepEqual(wyodrebnijNazwyWlasne('Geralt spotyka Dzikim Gonem na szlaku.'), ['wild hunt', 'geralt']);
  assert.deepEqual(wyodrebnijNazwyWlasne('Geralt rozmawia z Krwawym Baronem.'), ['bloody baron', 'geralt']);
  const ambiguousName = wyodrebnijNazwyWlasne('Dragonborn używa Smoczej Zguby.');
  assert.ok(ambiguousName.includes('dragonborn'));
  assert.equal(ambiguousName.includes('dragonrend'), false, 'ambiguous item name must not be forced to the Dragonrend shout');
});

test('Greatsword has a verified Polish item-name alias', () => {
  const entry = ENTITY_ALIAS_GROUPS.find(item => item.canonical === 'greatsword');
  assert.ok(entry);
  const pattern = buildAliasPattern(entry.names);
  assert.match('Wielki Miecz', pattern);
  assert.match('Greatsword', pattern);
});

test('production alias table excludes unverified Smoldering Church translation', () => {
  assert.equal(ENTITY_ALIAS_GROUPS.some(entry => entry.canonical === 'smoldering church'), false);
  assert.equal(KNOWN_ENTITY_ALIAS_PATTERNS.some(entry => entry.canonical === 'smoldering church'), false);
});

test('claim_en may match source wording when faithful, but cannot turn purpose into cause', () => {
  const quote = 'Chell and Wheatley forced a core transfer so that Wheatley could take control of Aperture.';
  const changedRelation = spojnoscTlumaczeniaClaimu(
    'Chell i Wheatley wymusili transfer rdzenia, ponieważ Wheatley mógł przejąć kontrolę nad Aperture.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(changedRelation.ok, false);
  assert.match(changedRelation.reason, /przyczynow|zdarzenie|relacj/i);

  const faithful = spojnoscTlumaczeniaClaimu(
    'Chell i Wheatley wymusili transfer rdzenia, aby Wheatley mógł przejąć kontrolę nad Aperture.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(faithful.ok, true, faithful.reason);
});

test('copied source wording cannot add a second fact, flip negation, or change the action target', () => {
  const quote = 'Chell and Wheatley forced a core transfer so that Wheatley could take control of Aperture.';

  const omittedPurpose = spojnoscTlumaczeniaClaimu(
    'Chell i Wheatley wymusili transfer rdzenia.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(omittedPurpose.ok, false, 'claim_en must not smuggle in the purpose/outcome absent from claim_pl');

  const changedNegation = spojnoscTlumaczeniaClaimu(
    'Chell i Wheatley nie wymusili transferu rdzenia, aby Wheatley mógł przejąć kontrolę nad Aperture.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(changedNegation.ok, false);

  const changedObject = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Chell.',
    'Wheatley took control of Aperture.',
    { evidenceQuote: 'Wheatley took control of Aperture.' },
  );
  assert.equal(changedObject.ok, false);
});

test('reason-why wording remains equivalent in an abstention translation', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Nie ma dostępnych danych potwierdzających przyczynę, dla której Dragonborn został wciągnięty w konflikt ze smokami.',
    'There is no available data confirming the reason why the Dragonborn was drawn into a conflict with dragons.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('Cyberpunk Relik/Relic is a contextual translation alias, not a global entity alias', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Po śmierci głównego bohatera Relik aktywuje engram Johnny’ego Silverhanda.',
    'After the protagonist dies, the Relic activates Johnny Silverhand’s engram.',
  );
  assert.equal(result.ok, true, result.reason);
  assert.equal(KNOWN_ENTITY_ALIAS_PATTERNS.some(entry => entry.canonical === 'relic'), false);
});

test('generic sentence quantifiers are not extracted as proper names', () => {
  const names = wyodrebnijNazwyWlasne('Wszystkie te działania są opisane w przewodniku.');
  assert.equal(names.includes('wszystkie'), false);
});

test('faithful translation accepts different Polish and English names through explicit aliases', () => {
  const quote = 'The Wild Hunt captured the Bloody Baron.';
  const result = spojnoscTlumaczeniaClaimu(
    'Dziki Gon schwytał Krwawego Barona.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(result.ok, true, result.reason);
});
