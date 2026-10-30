'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

// Regresja po da47ee7: reguła „samo imię” przepuszczała podmianę nazwiska, bo sprawdzała tylko,
// że brakująca część nazwy nie występuje w cytacie — nie sprawdzała, co w cytacie stoi obok imienia.
test('first-name shortcut is rejected when the quote names a different surname', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Johnny Silverhand jest piosenkarzem.',
    'Johnny Cash is a singer.',
    { evidenceQuote: 'Johnny Cash is a famous singer.', evidenceContext: 'Johnny Cash is a famous singer.' },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /nazwy własne: silverhand/);
});

test('first-name shortcut is still accepted when the quote only uses the first name', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Johnny Silverhand jest piosenkarzem.',
    'Johnny is a singer.',
    { evidenceQuote: 'Johnny is a famous singer.', evidenceContext: 'Johnny is a famous singer.' },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('first-name shortcut requires the first name to occur in the quote', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Johnny Silverhand jest piosenkarzem.',
    'Johnny is a singer.',
    { evidenceQuote: 'Kerry is a famous singer.', evidenceContext: 'Kerry is a famous singer.' },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
});

// Polskie „skutkuje” to „resulting in”: claim_en, który gubi relację przyczynową, musi być odrzucony,
// a wierne tłumaczenie z zachowaną relacją przechodzi kontrolę parytetu.
test('Polish skutkuje counts as a causal marker in the translation parity check', () => {
  const dropped = spojnoscTlumaczeniaClaimu(
    'Gracz zdaje test, co skutkuje dołączeniem Astariona.',
    'The player passes the test.',
  );
  assert.equal(dropped.ok, false, JSON.stringify(dropped));
  assert.match(dropped.reason, /relację przyczynową/);

  const kept = spojnoscTlumaczeniaClaimu(
    'Gracz zdaje test, co skutkuje dołączeniem Astariona.',
    'The player passes the test, resulting in Astarion joining.',
  );
  assert.equal(kept.ok, true, JSON.stringify(kept));
});
