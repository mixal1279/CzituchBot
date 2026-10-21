'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizujWynikWalidatora } = require('../ai/validator');
const { spojnoscTlumaczeniaClaimu, zbudujWyroczniaNazw, wyodrebnijLiczbyIDaty } = require('../ai/claimValidation');

function wynikModelu(claim, quote) {
  return {
    valid: true,
    reason: 'ok',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence: 0.95,
    claims: [{ claim, supported: true, source_ids: ['SOURCE 1'], evidence_quote: quote }],
  };
}

function dane(tresc) {
  return '[SOURCE 1]\nTYTUŁ: Test\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\n' + tresc + '\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
}

test('Roman numeral extraction ignores common abbreviations but keeps game sequel numerals', () => {
  assert.deepEqual(wyodrebnijLiczbyIDaty('Astarion gra w MC, a tekst zawiera CD i MM.'), []);
  assert.deepEqual(wyodrebnijLiczbyIDaty("Baldur's Gate III"), ['3']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Portal 2'), ['2']);
});

test('English "so that" in the source supports a Polish causal claim', () => {
  const quote = 'Chell and Wheatley force a core transfer on GLaDOS so that Wheatley can take control of the facility and he and Chell can escape.';
  const claim = 'Chell i Wheatley wymusili transfer rdzenia z GLaDOS, co umożliwiło Wheatleyowi przejęcie kontroli nad całym ośrodkiem.';
  const result = normalizujWynikWalidatora(wynikModelu(claim, quote), 'test-model', 'test', new Set(['SOURCE 1']), dane(quote), claim);
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.evidenceBindings[0].mode, 'exact_quote');
});

test('a purpose clause cannot prove that the intended outcome actually occurred', () => {
  const quote = 'Chell pushed the button so that Wheatley could take control.';
  const claim = 'Wheatley took control because Chell pushed the button.';
  const result = normalizujWynikWalidatora(
    wynikModelu(claim, quote),
    'test-model',
    'test',
    new Set(['SOURCE 1']),
    dane(quote),
    claim,
  );
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /cel lub możliwość.*skutek jako dokonany/);

  const escapeQuote = 'Chell opened the door so that Wheatley could escape.';
  const escapeClaim = 'Wheatley escaped because Chell opened the door.';
  const escapeResult = normalizujWynikWalidatora(
    wynikModelu(escapeClaim, escapeQuote),
    'test-model',
    'test',
    new Set(['SOURCE 1']),
    dane(escapeQuote),
    escapeClaim,
  );
  assert.equal(escapeResult.status, 'rejected');
});

test('conditional-only evidence cannot support an unconditional claim', () => {
  const { zgodnoscStrukturalna } = require('../ai/claimValidation');
  const conditionalEvidence = 'The door opens only when the switch is off.';
  const unconditionalClaim = 'The door opens.';
  const result = zgodnoscStrukturalna(conditionalEvidence, unconditionalClaim);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /dowód jest warunkowy/);

  const qualifiedClaim = 'The door opens only when the switch is off.';
  assert.equal(zgodnoscStrukturalna(conditionalEvidence, qualifiedClaim).ok, true);
});

test('short two-word infobox quotes are accepted when the entity and concept checks pass', () => {
  const claim = 'Astarion is a Rogue.';
  const result = normalizujWynikWalidatora(wynikModelu(claim, 'Class Rogue'), 'test-model', 'test', new Set(['SOURCE 1']), dane('Astarion Gender Male Class Rogue Race High Elf'), claim);
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.evidenceBindings[0].quoteVerified, true);
});

test('short infobox quote must be bound to the claimed entity', () => {
  const claim = 'Astarion is a Rogue.';
  const quote = 'Class Rogue';
  const unrelated = normalizujWynikWalidatora(
    wynikModelu(claim, quote),
    'test-model',
    'test',
    new Set(['SOURCE 1']),
    dane('Geralt Gender Male Class Rogue Race Human'),
    claim,
  );
  assert.equal(unrelated.status, 'rejected');
  assert.match(unrelated.reason, /krótki cytat z infoboksu nie wiąże pola/);
});

test('single-word and very short quotes are still rejected as evidence', () => {
  const claim = 'Astarion is a Rogue.';
  for (const quote of ['Rogue', 'a Rogue']) {
    const result = normalizujWynikWalidatora(wynikModelu(claim, quote), 'test-model', 'test', new Set(['SOURCE 1']), dane('Astarion is a Rogue.'), claim);
    assert.equal(result.status, 'rejected', quote);
    assert.equal(result.diagnostics.evidenceBindings[0].supportVerified, false, quote);
    assert.match(result.diagnostics.evidenceBindings[0].reason, /nieprawidłową długość/, quote);
  }
});

test('claim_en passes when a Polish-localized name is absent from both the English text and the sources', () => {
  const source = 'The Greatsword is in northwestern Caelid, on the road that leads south toward the Cathedral of Dragon Communion.';
  const nameOracle = zbudujWyroczniaNazw([{ content: source }]);
  const claim = 'Wielki Miecz znajduje się w północno-zachodniej części Caelid, przy drodze prowadzącej na południe w stronę Katedry Komunii Smoka.';
  const result = spojnoscTlumaczeniaClaimu(claim, source, { nameOracle });
  assert.equal(result.ok, true, result.reason);
});

test('claim_en copied from the evidence quote must still agree with the Polish claim', () => {
  const quote = 'Wheatley took control of Aperture.';
  const mismatch = spojnoscTlumaczeniaClaimu(
    'Wheatley zniszczył Aperture.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(mismatch.ok, false, JSON.stringify(mismatch));
  assert.match(mismatch.reason, /nie odpowiada treści claimu/);

  const faithful = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture.',
    quote,
    { evidenceQuote: quote },
  );
  assert.equal(faithful.ok, true, JSON.stringify(faithful));
});

test('claim_en still fails when a source-backed name is dropped from the translation', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'Later, Wheatley took control of the facility.' }]);
  const result = spojnoscTlumaczeniaClaimu('Wheatley przejął kontrolę nad obiektem.', 'He took control of the facility.', { nameOracle });
  assert.equal(result.ok, false);
  assert.match(result.reason, /nazwy własne/);
});
