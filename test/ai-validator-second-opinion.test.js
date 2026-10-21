'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { czyWartoDrugaOpinieWalidatora } = require('../ai/validator');

test('hard negation conflict skips redundant second opinions and goes to repair', () => {
  const result = {
    status: 'rejected',
    reason: 'claim i dowód mają inną negację',
    diagnostics: {
      localRejectReasons: ['evidence_not_verified'],
      unsupportedEvidenceClaims: [{ reasons: ['claim i dowód mają inną negację'] }],
    },
  };
  assert.equal(czyWartoDrugaOpinieWalidatora(result), false);
});

test('unsupported causal inference skips redundant second opinions', () => {
  const result = {
    status: 'rejected',
    diagnostics: {
      localRejectReasons: ['evidence_not_verified'],
      unsupportedEvidenceClaims: [{
        reasons: ['claim dodaje relację przyczynową nieobecną w kontekście cytatu: SOURCE 5'],
      }],
    },
  };
  assert.equal(czyWartoDrugaOpinieWalidatora(result), false);
});

test('ambiguous proper-name/evidence binding can still receive an independent opinion', () => {
  const result = {
    status: 'rejected',
    diagnostics: {
      localRejectReasons: ['evidence_not_verified'],
      unsupportedEvidenceClaims: [{
        reasons: ['dowód nie zawiera wszystkich istotnych nazw własnych claimu'],
      }],
    },
  };
  assert.equal(czyWartoDrugaOpinieWalidatora(result), true);
});

test('accepted results never trigger a second opinion', () => {
  assert.equal(czyWartoDrugaOpinieWalidatora({ status: 'accepted' }), false);
});
