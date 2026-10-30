'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { spojnoscTlumaczeniaClaimu, zbudujWyroczniaNazw } = require('../ai/claimValidation');

// Z wyrocznią nazw (wywołanie z źródłami) słowo na początku zdania, które nie ma żadnego sygnału nazwy,
// jest rzeczownikiem pospolitym. Wcześniej drugi przebieg bez wyroczni liczył je jako nazwę i claim
// odpadał jako „gubi nazwy własne” (why-005 „Wspólny”, how-061 „Przedmiotu”).
test('a sentence-initial common noun without a name signal is not a lost proper name', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'The party shares a common problem.' }]);
  const wspolny = spojnoscTlumaczeniaClaimu(
    'Wspólny problem z larwą zmusza postacie do odłożenia różnic na bok w celu przetrwania.',
    'The shared problem forces characters to put their differences aside to survive.',
    { nameOracle },
  );
  assert.equal(wspolny.ok, true, JSON.stringify(wspolny));

  const przedmiotu = spojnoscTlumaczeniaClaimu(
    'Przedmiotu pilnują shulker oraz dwie skrzynie z łupem.',
    'A shulker guards the elytra along with two loot chests.',
    { nameOracle },
  );
  assert.equal(przedmiotu.ok, true, JSON.stringify(przedmiotu));
});

// Nazwa z sygnałem (tu: obecna w źródłach z wielką literą w środku zdania) nadal musi zostać w tłumaczeniu.
test('a sentence-initial name that the sources confirm must still survive the translation', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'Later, Wheatley took control of the facility.' }]);
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad obiektem.',
    'He took control of the facility.',
    { nameOracle },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /nazwy własne: wheatley/);
});

// Bez wyroczni (wywołanie bez źródeł) zachowanie jest bez zmian: każde słowo na początku zdania liczy się.
test('without a name oracle every sentence-initial token is still required', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad obiektem.',
    'He took control of the facility.',
  );
  assert.equal(result.ok, false, JSON.stringify(result));
});

// „Statki End…”: obok jest nazwa pisana wielką literą, więc „Statki” jest na liście słów otwierających zdanie.
test('Statki End is a common noun followed by a known place, not a name', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'The structures called End ships can be found in the End.' }]);
  const result = spojnoscTlumaczeniaClaimu(
    'Statki End generują się przy niektórych miastach End',
    'End ships are found in some End cities',
    { nameOracle },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

// „Perła Kresu” to polska nazwa Ender Pearl (Kres = End).
test('perła Kresu is the Polish name of the Ender Pearl', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'You can throw an Ender Pearl onto the roof of the ship.' }]);
  const result = spojnoscTlumaczeniaClaimu(
    'Aby wejść na statek, należy rzucić perłę Kresu na jego dach lub zbudować most.',
    'To enter the ship, you need to throw an ender pearl onto its roof or build a bridge.',
    { nameOracle },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
