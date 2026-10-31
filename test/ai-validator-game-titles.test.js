'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sprawdzTwardeKonflikty, zgodnoscStrukturalna } = require('../ai/claimValidation');

const BG3_EVIDENCE = 'Astarion can be found on the edge of the map near an unoccupied stasis pod from the wreckage of the Nautiloid (coordinates: X: 170, Y: 287).';
const BG3_CLAIM = "In Baldur's Gate 3, Astarion can be encountered near the wreckage of the Nautiloid.";

// Claim, który powtarza tytuł gry z pytania, nie może odpadać dlatego, że numerał z tytułu
// („3”, „2077”) albo słowa tytułu („Baldur's”, „Gate”) nie występują w cytacie.
test('a numeral that belongs to a game title is not a number the quote must contain', () => {
  const bg3 = sprawdzTwardeKonflikty(BG3_EVIDENCE, BG3_CLAIM, { ignoreNegation: true });
  assert.equal(bg3.ok, true, JSON.stringify(bg3));

  const cyberpunk = sprawdzTwardeKonflikty(
    'Johnny Silverhand is a rockerboy and lead vocalist of Samurai.',
    'In Cyberpunk 2077, Johnny Silverhand is a rockerboy.',
    { ignoreNegation: true },
  );
  assert.equal(cyberpunk.ok, true, JSON.stringify(cyberpunk));
});

test('numbers outside the game title are still required in the evidence', () => {
  const result = sprawdzTwardeKonflikty(
    BG3_EVIDENCE,
    "In Baldur's Gate 3, Astarion has 5 allies.",
    { ignoreNegation: true },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /liczb/);
});

test('the title numeral is still checked when the evidence names another entry of the series', () => {
  const result = zgodnoscStrukturalna(
    'Fallout 3 has 5 factions.',
    'In Fallout 4, there are 5 factions.',
    { allowCrossLanguageExactEvidence: true },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /liczb/);
});

test('game title words do not have to occur in the evidence, other names still do', () => {
  const supported = zgodnoscStrukturalna(BG3_EVIDENCE, BG3_CLAIM, {
    allowCrossLanguageExactEvidence: true,
    allowDistributedEvidence: true,
  });
  assert.equal(supported.ok, true, JSON.stringify(supported));

  // Podmiana postaci przy tym samym tytule nadal musi paść.
  const swapped = zgodnoscStrukturalna(
    BG3_EVIDENCE,
    "In Baldur's Gate 3, Gale can be encountered near the wreckage of the Nautiloid.",
    { allowCrossLanguageExactEvidence: true, allowDistributedEvidence: true },
  );
  assert.equal(swapped.ok, false, JSON.stringify(swapped));
});


 
test('GTA V title numeral is not mistaken for a factual number in a cited claim', () => {
  const result = sprawdzTwardeKonflikty(
    'Nine years after a failed robbery, Michael unexpectedly encounters Trevor Philips.',
    'Michael meets Trevor in GTA V.',
    { ignoreNegation: true },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('a different GTA sequel in the evidence still conflicts with GTA V in the claim', () => {
  const result = zgodnoscStrukturalna(
    'Michael meets Trevor in GTA IV.',
    'Michael meets Trevor in GTA V.',
    { allowCrossLanguageExactEvidence: true },
  );
  assert.equal(result.ok, false, JSON.stringify(result));
});
