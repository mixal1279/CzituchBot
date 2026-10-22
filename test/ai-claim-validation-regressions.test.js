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