'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { spojnoscTlumaczeniaClaimu, pojeciaCrossLanguage } = require('../ai/claimValidation');

// Regresja: w literale regex „\\s” to dosłowny backslash + „s”, więc podział prefiksu
// na zdania nigdy nie działał i imię z POPRZEDNIEGO zdania wiązało się z anaforycznym cytatem.
test('anaphoric quote binds the claimed name only within the same sentence', () => {
  const claimPl = 'Wheatley pojawia się w kampanii.';
  const claimEn = 'who appears in the campaign';
  const sameSentence = spojnoscTlumaczeniaClaimu(claimPl, claimEn, {
    evidenceQuote: 'who appears in the campaign',
    evidenceContext: 'Wheatley, who appears in the campaign, is a personality core.',
  });
  assert.equal(sameSentence.ok, true, JSON.stringify(sameSentence));

  const previousSentence = spojnoscTlumaczeniaClaimu(claimPl, claimEn, {
    evidenceQuote: 'who appears in the campaign',
    evidenceContext: 'Wheatley is a personality core. Chell, who appears in the campaign, is a test subject.',
  });
  assert.equal(previousSentence.ok, false, JSON.stringify(previousSentence));
  assert.match(previousSentence.reason, /nazwy własne: wheatley/);
});

// Regresja: „appear\w*” bez granicy słowa łapało „disappears”, więc claim_en skopiowany z cytatu
// o znikaniu mógł zostać uznany za tłumaczenie claimu o pojawianiu się.
test('disappears is not classified as the appearance concept', () => {
  assert.equal(pojeciaCrossLanguage('Wheatley disappears from the laboratory').has('wystepowanie'), false);
  assert.equal(pojeciaCrossLanguage('Wheatley appears in the laboratory').has('wystepowanie'), true);
  assert.equal(pojeciaCrossLanguage('Wheatley pojawia się w laboratorium').has('wystepowanie'), true);

  const copiedOppositeQuote = spojnoscTlumaczeniaClaimu(
    'Wheatley pojawia się w laboratorium.',
    'Wheatley disappears from the laboratory.',
    { evidenceQuote: 'Wheatley disappears from the laboratory.' },
  );
  assert.equal(copiedOppositeQuote.ok, false, JSON.stringify(copiedOppositeQuote));
});

// Regresja: „tlum\w*” łapało „tłumaczy” i „tłum”, więc poprawne tłumaczenie „tłumaczy” → „explains”
// było odrzucane jako zmiana kierunku redukcji.
test('tlumaczy is not a reduction or behaviour-modification marker', () => {
  const result = spojnoscTlumaczeniaClaimu('Wheatley tłumaczy plan.', 'Wheatley explains the plan.');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(pojeciaCrossLanguage('Wheatley tłumaczy plan').has('modyfikacja_zachowania'), false);
  assert.equal(pojeciaCrossLanguage('inteligencja tłumiąca').has('modyfikacja_zachowania'), true);
});

// Cytat może używać skróconej nazwy, podczas gdy claim_en zachowuje pełną nazwę
// podaną w pytaniu/claim_pl.
test('first-name-only claim_en is accepted when the quote context lacks the surname', () => {
  const quote = "Johnny is introduced as a principle character in Cyberpunk 2077, the headliner of the band SAMURAI and the snarky digital engram that resides in V's brain.";
  const result = spojnoscTlumaczeniaClaimu(
    'Johnny Silverhand jest cyfrowym engramem mieszkającym w umyśle V.',
    "Johnny is a digital engram that resides in V's brain.",
    { evidenceQuote: quote, evidenceContext: quote },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});
