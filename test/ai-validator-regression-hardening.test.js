'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAUSAL_RE,
  spojnoscTlumaczeniaClaimu,
  wyodrebnijNazwyWlasne,
} = require('../ai/claimValidation');

test('sentence-initial quantifiers are not extracted as proper names', () => {
  const names = wyodrebnijNazwyWlasne('Wszystkie szczegóły opisuje Artur w swoim dzienniku.');
  assert.equal(names.includes('wszystkie'), false);
  assert.equal(names.includes('artur'), true);
});


test('sentence-internal generic words are not mistaken for proper names', () => {
  const rdr2 = wyodrebnijNazwyWlasne('Arthur Morgan trafia do Saint Denis w Rozdziale 4.');
  assert.equal(rdr2.includes('rozdziale'), false);
  assert.equal(rdr2.includes('arthur'), true);
  assert.equal(rdr2.includes('morgan'), true);
  assert.equal(rdr2.includes('saint'), true);
  assert.equal(rdr2.includes('denis'), true);

  const portal = wyodrebnijNazwyWlasne('Pojawia się w kampanii jednoosobowej gry. Pomaga Chell w ucieczce z Centrum Rozbudowy Aperture Science.');
  assert.equal(portal.includes('pojawia'), false);
  assert.equal(portal.includes('pomaga'), false);
  assert.equal(portal.includes('centrum'), false);
  assert.equal(portal.includes('rozbudowy'), false);
  assert.equal(portal.includes('aperture science'), true);

  const bg3 = wyodrebnijNazwyWlasne('Wewnątrz obozu goblinów prowadzi droga do głównej części obozu.');
  assert.equal(bg3.includes('wewnatrz'), false);
  assert.equal(bg3.includes('obozu'), false);
  assert.equal(bg3.includes('droga'), false);
});

test('curly apostrophes in inflected names remain intact during normalization', () => {
  const names = wyodrebnijNazwyWlasne('Johnny’ego Silverhanda spotyka Geralt.');
  assert.equal(names.includes('johnny’ego'), true);
  assert.equal(names.includes('johnny ego'), false);
});

test('purpose connectors are not treated as causal evidence markers by themselves', () => {
  for (const phrase of [
    'Aby uratować drużynę, bohater ruszył dalej.',
    'Żeby otworzyć drzwi, gracz nacisnął przycisk.',
    'W celu zdobycia klucza postać weszła do budynku.',
    'Celem misji było odnalezienie artefaktu.',
  ]) {
    assert.equal(CAUSAL_RE.test(phrase), false, phrase);
  }
});

test('epistemic reason-why translation remains equivalent across Polish and English', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Nie ma danych potwierdzających przyczynę, dla której Wheatley przejął kontrolę nad Aperture.',
    'There is no data confirming the reason why Wheatley took control of Aperture.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});


test('Polish intelligence-dampening descriptor matches its English equivalent', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley jest inteligencyjną sferą tłumiącą.',
    'Wheatley is an intelligence dampening sphere.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('appearance in a campaign remains equivalent across Polish and English', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley pojawia się w kampanii jednoosobowej gry Portal 2.',
    'Wheatley appears in the single-player campaign of Portal 2.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});


test('relative-clause quote matching uses the same whitespace normalization as quote verification', () => {
  const claim = 'Wheatley pojawia się w kampanii jednoosobowej gry Portal 2.';
  const quote = 'who appears in the single-player campaign of Portal 2.';
  const context = 'The Intelligence Dampening Sphere, more commonly known as Wheatley, is a personality core who  appears in the single-player campaign of Portal 2.';
  const result = spojnoscTlumaczeniaClaimu(claim, quote, {
    evidenceQuote: quote,
    evidenceContext: context,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('relative-clause quote can inherit a proper-name subject only from its adjacent source context', () => {
  const claim = 'Wheatley pojawia się w kampanii jednoosobowej gry Portal 2.';
  const quote = 'who appears in the single-player campaign of Portal 2.';
  const context = 'The Intelligence Dampening Sphere, more commonly known as Wheatley, is a personality core of masculine programming and English West Country accent who appears in the single-player campaign of Portal 2.';
  const withoutContext = spojnoscTlumaczeniaClaimu(claim, quote, { evidenceQuote: quote });
  assert.equal(withoutContext.ok, false, JSON.stringify(withoutContext));

  const withContext = spojnoscTlumaczeniaClaimu(claim, quote, {
    evidenceQuote: quote,
    evidenceContext: context,
  });
  assert.equal(withContext.ok, true, JSON.stringify(withContext));
});


test('translation still rejects a changed causal relation', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture, ponieważ GLaDOS zniknęła.',
    'Wheatley took control of Aperture after GLaDOS disappeared.',
  );
  assert.equal(result.ok, false);
});
