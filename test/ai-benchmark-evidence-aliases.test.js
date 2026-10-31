'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  czyNazwaWlasnaWystepuje,
  spojnoscTlumaczeniaClaimu,
} = require('../ai/claimValidation');

test('Witcher 3 Feline Armor is matched to its Polish localized name', () => {
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Zbroja Szkoły Kota'), true);
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Zbroja wiedźmińskiego cechu kota'), true);
});

test('Witcher 3 Temple Isle is matched to inflected Polish forms', () => {
  assert.equal(czyNazwaWlasnaWystepuje('temple isle', 'na Wyspie Świątynnej'), true);
  assert.equal(czyNazwaWlasnaWystepuje('temple isle', 'północna strona Wyspy Świątynnej'), true);
});

test('Witcher 3 Eye of Nehaleni is matched to Polish inflection', () => {
  assert.equal(czyNazwaWlasnaWystepuje('eye of nehaleni', 'używając Oka Nehaleni'), true);
});

test('GTA V Prolog is recognized as the localized Prologue mission name', () => {
  assert.equal(czyNazwaWlasnaWystepuje('prologue', 'Prologue is the first mission in Grand Theft Auto V.'), true);
  assert.equal(czyNazwaWlasnaWystepuje('prologue', 'Misja Prolog rozpoczyna historię.'), true);
  const result = spojnoscTlumaczeniaClaimu(
    'Michael po raz pierwszy spotyka Trevora w misji Prolog.',
    'Michael meets Trevor for the first time in the Prologue mission.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('Minecraft End City and End Ship are separate localized entities', () => {
  assert.equal(czyNazwaWlasnaWystepuje('end city', 'End City'), true);
  assert.equal(czyNazwaWlasnaWystepuje('end city', 'End Cities'), true);
  assert.equal(czyNazwaWlasnaWystepuje('end city', 'Miasto Endu'), true);
  assert.equal(czyNazwaWlasnaWystepuje('end ship', 'End Ship'), true);
  assert.equal(czyNazwaWlasnaWystepuje('end ship', 'End Ships'), true);
  assert.equal(czyNazwaWlasnaWystepuje('end ship', 'Statek Endu'), true);
  assert.equal(czyNazwaWlasnaWystepuje('end ship', 'End City'), false);
  assert.equal(czyNazwaWlasnaWystepuje('end city', 'End Ship'), false);
  const correctTranslation = spojnoscTlumaczeniaClaimu(
    'End City znajduje się na zewnętrznych wyspach Endu.',
    'End City is located on the outer islands of the End.',
  );
  assert.equal(correctTranslation.ok, true, JSON.stringify(correctTranslation));
  const swappedStructure = spojnoscTlumaczeniaClaimu(
    'End City znajduje się na zewnętrznych wyspach Endu.',
    'End Ship is located on the outer islands of the End.',
  );
  assert.equal(swappedStructure.ok, false, JSON.stringify(swappedStructure));
});

test('Polish ochron* and English protection have matching translation polarity', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Astarion chce zyskać przychylność i ochronę postaci gracza przed Cazadorem.',
    "Astarion wants to gain the player character's favor and protection from Cazador.",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});


test('Witcher 3 Feline gear aliases preserve the localized armor item', () => {
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Zbroja Szkoły Kota'), true);
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Rynsztunek Szkoły Kota'), true);
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Feline gear set'), true);
  assert.equal(czyNazwaWlasnaWystepuje('feline armor', 'Zbroja Szkoły Wilka'), false);
});

test('Skyrim Dovahkiin aliases cover source spelling, inflection and the Dragonborn title', () => {
  assert.equal(czyNazwaWlasnaWystepuje('dovahkiin', 'Laat Dovahkiin'), true);
  assert.equal(czyNazwaWlasnaWystepuje('dovahkiin', 'Dovahkiin'), true);
  assert.equal(czyNazwaWlasnaWystepuje('dovahkiin', 'Dark Brotherhood'), false);
});

test('causal translation accepts the source wording as they have a better chance', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Astarion chętnie dołącza do drużyny, gdyż jako grupa mają większe szanse na znalezienie lekarstwa na kijanki.',
    'After clearing up the misunderstanding, Astarion happily joins the party as they have a better chance of finding a cure for their tadpoles together.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('causal translation preserves the Polish pozwala / English enables relation', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'To pozwala Dragonbornowi wykorzystać zdolność smoków do pochłaniania dusz poległych smoków.',
    'It enables the Dragonborn to use the dragons’ ability to absorb a slain dragon’s soul.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('a copied source quote may be broader than the narrower Polish atomic claim', () => {
  const quote = 'To enter, you need to throw the ender pearl onto the roof of the ship or build a one block wide bridge to the ship.';
  const result = spojnoscTlumaczeniaClaimu(
    'Aby wejść do statku, należy wyrzucić perłę Endera na dach lub zbudować jednoblockowy most.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('the word block in Minecraft bridge width is not a protection/reduction marker', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Aby zbudować jednoblockowy most do statku, należy postawić most o szerokości jednego bloku.',
    'To build a one block wide bridge to the ship, build a bridge that is one block wide.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('causal translation rejects reversing Thuum knowledge and dragon-soul absorption', () => {
  const result = spojnoscTlumaczeniaClaimu(
    "Dragonborn wykorzystuje Thu'um, co pozwala mu pochłaniać dusze smoków.",
    "It enables them to use the dragon's ability to absorb a slain dragon's soul to receive knowledge of the Thu'um.",
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /odwraca relację/);
});
