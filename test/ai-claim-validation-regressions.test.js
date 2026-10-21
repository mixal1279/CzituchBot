'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAUSAL_RE,
  normalizujClaim,
  spojnoscTlumaczeniaClaimu,
} = require('../ai/claimValidation');

test('causal translation accepts Polish spowodowała and English triggered as equivalent signals', () => {
  const pl = normalizujClaim('Obecność Wheatleya spowodowała zainicjowanie transferu rdzenia.');
  const en = normalizujClaim("Wheatley's presence triggered a core transfer.");
  assert.equal(CAUSAL_RE.test(pl), true);
  assert.equal(CAUSAL_RE.test(en), true);
  assert.equal(spojnoscTlumaczeniaClaimu(
    'Obecność Wheatleya spowodowała zainicjowanie transferu rdzenia.',
    "Wheatley's presence triggered a core transfer.",
  ).ok, true);
});

test('a source phrase saying someone was removed from power can support the Polish control paraphrase', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley został przeniesiony do ciała GLaDOS, przejmując jej kontrolę.',
    "Wheatley is transferred into GLaDOS' body and she is removed from power.",
    { evidenceQuote: "Wheatley is transferred into GLaDOS' body and she is removed from power." },
  );
  assert.equal(result.ok, true, result.reason);
});

test('English resistance and Polish odporność use the same protection signal', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Możesz również zwiększyć odporność na ogień, mróz lub magię.',
    'You can try increasing your Frost, Fire or magic resistance.',
  );
  assert.equal(result.ok, true, result.reason);
});
