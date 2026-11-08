'use strict';

// Kontrakt claim ↔ claim_en: testy czystych funkcji z ai/claimValidation.js.
// Każdy przypadek odpowiada konkretnej luce znalezionej w analizie regresji.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  spojnoscTlumaczeniaClaimu,
  czyNazwaWlasnaWystepuje,
  sprawdzSprzecznosciSemantyczne,
} = require('../ai/claimValidation');

test('translation that replaces taking control with destruction is rejected without phrase-specific rules', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture.',
    'Wheatley destroyed Aperture.',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /zdarzenie|relacj/i);
});

test('faithful translation of taking control is accepted', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture.',
    'Wheatley took control of Aperture.',
  );
  assert.equal(result.ok, true);
});

test('control and destruction are opposite events in both directions', () => {
  assert.equal(sprawdzSprzecznosciSemantyczne('Wheatley took control of Aperture.', 'Wheatley destroyed Aperture.').ok, false);
  assert.equal(sprawdzSprzecznosciSemantyczne('Wheatley destroyed Aperture.', 'Wheatley took control of Aperture.').ok, false);
});

test('inflected feminine name (Arasakę/Arasaką) matches nominative in the English translation', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Johnny Silverhand był związany z Alt Cunningham, a porwanie Alt przez Arasakę pogłębiło jego konflikt z Arasaką.',
    'Johnny Silverhand was involved with Alt Cunningham, and Alt’s capture by Arasaka deepened his conflict with Arasaka.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('English possessive does not hide a short proper name', () => {
  assert.equal(
    czyNazwaWlasnaWystepuje('Alt’s', 'their relationship was damaged after arasaka captured alt'),
    true,
  );
  assert.equal(
    czyNazwaWlasnaWystepuje('Alt’s', 'their relationship was damaged after arasaka captured chell'),
    false,
  );
});

test('copied quote with an inflected Polish noun still shares the boss concept', () => {
  const quote = 'Malenia is an optional boss in Elden Ring.';
  const result = spojnoscTlumaczeniaClaimu(
    'Malenia jest opcjonalnym bossem w Elden Ring.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(result.ok, true, result.reason);
});

test('copied quote that turns killing into capture keeps the specific diagnostic', () => {
  const quote = 'Wheatley captured Chell.';
  const result = spojnoscTlumaczeniaClaimu('Wheatley zabił Chella.', quote, { evidenceQuote: quote });
  assert.equal(result.ok, false);
  assert.match(result.reason, /nie odpowiada treści claimu/);
  assert.match(result.reason, /zab[oó]jstwo|schwytanie/);
});


test('translation cannot swap the acting entity with the affected entity', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture.',
    'Aperture took control of Wheatley.',
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /podmiot/i);
});

test('subject-role check allows a faithful active translation', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture.',
    'Wheatley took control of Aperture.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('subject-role check does not reject an equivalent passive-to-active translation', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Chell została schwytana przez Wheatleya.',
    'Wheatley captured Chell.',
  );
  assert.equal(result.ok, true, result.reason);
});


test('causal translation cannot swap the cause and affected entity', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Aperture spowodowało upadek GLaDOS.',
    'GLaDOS caused Aperture to fall.',
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /podmiot/i);
});

test('causal translation preserves the same acting entity', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Aperture spowodowało upadek GLaDOS.',
    'Aperture caused GLaDOS to fall.',
  );
  assert.equal(result.ok, true, result.reason);
});

