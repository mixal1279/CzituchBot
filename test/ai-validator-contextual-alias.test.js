'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

test('localized Relik name maps to Relic only in Cyberpunk context', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'W Cyberpunk 2077 Relik jest powiązany z engramem.',
    'In Cyberpunk 2077, the Relic is linked to the engram.',
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('localized Relik is not treated as a global alias outside Cyberpunk context', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Relik jest starożytną relikwią.',
    'The relic is an ancient artifact.',
  );
  assert.equal(result.ok, false);
});
