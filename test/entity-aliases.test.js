'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAliasPattern, buildEntityAliasPatterns } = require('../ai/entityAliases');
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
  assert.deepEqual(wyodrebnijNazwyWlasne('Dragonborn używa Smoczej Zguby.'), ['dragonrend']);
});

test('claim_en przepisany z evidence_quote jest odrzucany, prawdziwe tłumaczenie nie', () => {
  const quote = 'Malenia is an optional boss located in Haligtree Elphael.';
  const copy = spojnoscTlumaczeniaClaimu('Malenia jest opcjonalnym bossem w Haligtree Elphael.', quote, { evidenceQuote: quote });
  assert.equal(copy.ok, false);
  assert.match(copy.reason, /kopią evidence_quote/);
  const real = spojnoscTlumaczeniaClaimu('Malenia jest opcjonalnym bossem w Haligtree Elphael.', 'Malenia is an optional boss in Haligtree Elphael.', { evidenceQuote: quote });
  assert.equal(real.ok, true);
});
