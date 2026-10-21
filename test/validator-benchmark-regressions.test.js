'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizujWynikWalidatora } = require('../ai/validator');
const { spojnoscTlumaczeniaClaimu, zbudujWyroczniaNazw, wyodrebnijLiczbyIDaty } = require('../ai/claimValidation');

function wynikModelu(claim, quote, claimEn = '') {
  return {
    valid: true,
    reason: 'ok',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence: 0.95,
    claims: [{ claim, supported: true, source_ids: ['SOURCE 1'], evidence_quote: quote, ...(claimEn ? { claim_en: claimEn } : {}) }],
  };
}

function dane(tresc) {
  return '[SOURCE 1]\nTYTUŁ: Test\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\n' + tresc + '\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
}

test('Roman numeral extraction ignores common abbreviations but keeps game sequel numerals', () => {
  assert.deepEqual(wyodrebnijLiczbyIDaty('Astarion gra w MC, a tekst zawiera CD, MM i MIX.'), []);
  assert.deepEqual(wyodrebnijLiczbyIDaty("Baldur's Gate III"), ['3']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Grand Theft Auto V'), ['5']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Final Fantasy X'), ['10']);
  assert.deepEqual(wyodrebnijLiczbyIDaty('Portal 2'), ['2']);
});

test('English "so that" in the source supports a Polish causal claim', () => {
  const quote = "Chell and Wheatley force a core transfer on GLaDOS so that Wheatley can take control of the facility. GLaDOS' head is removed from her body and Wheatley is put in its place, putting him in control of the facility.";
  const claim = 'Chell i Wheatley wymusili transfer rdzenia z GLaDOS, co umożliwiło Wheatleyowi przejęcie kontroli nad całym ośrodkiem.';
  const result = normalizujWynikWalidatora(wynikModelu(claim, quote, quote), 'test-model', 'test', new Set(['SOURCE 1']), dane(quote), claim);
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.evidenceBindings[0].mode, 'exact_quote');
});

test('causal control relation is recognized in quoted evidence', () => {
  const quote = "Via Core Transfer, GLaDOS' core is removed from her body and replaced with Wheatley's, giving him control of the facility.";
  const claim = 'Wheatley przejął kontrolę nad placówką w wyniku transferu rdzenia.';
  const claimEn = 'Wheatley took control of the facility as a result of the core transfer.';
  const result = normalizujWynikWalidatora(
    wynikModelu(claim, quote, claimEn),
    'test-model',
    'test',
    new Set(['SOURCE 1']),
    dane(quote),
    claim,
  );
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
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
  assert.equal(result.diagnostics.evidenceBindings[0].supportVerified, false);
  assert.match(result.reason, /cel lub możliwość.*skutek jako dokonany|correlation_to_causation/);

  const purposeClaim = 'Chell i Wheatley wymusili transfer rdzenia, aby Wheatley mógł przejąć kontrolę nad obiektem.';
  const purposeQuote = 'Chell and Wheatley force a core transfer on GLaDOS so that Wheatley can take control of the facility.';
  const purposeResult = normalizujWynikWalidatora(wynikModelu(purposeClaim, purposeQuote, purposeQuote), 'test-model', 'test', new Set(['SOURCE 1']), dane(purposeQuote), purposeClaim);
  assert.equal(purposeResult.status, 'accepted', JSON.stringify(purposeResult.diagnostics));

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

test('lack of stability is not confused with sentence negation but contradicts a positive stability claim', () => {
  const { zgodnoscStrukturalna } = require('../ai/claimValidation');
  const evidence = 'The lack of stability will cause destruction.';
  assert.equal(zgodnoscStrukturalna(evidence, 'Instability will cause destruction.').ok, true);
  const contradiction = zgodnoscStrukturalna(evidence, 'Stability will cause destruction.');
  assert.equal(contradiction.ok, false, JSON.stringify(contradiction));
  assert.match(contradiction.reason, /brak stabilności/);
});

test('validator accepts source-matched fire-attack advice without narrowing it to dragon breath', () => {
  const quote = 'To avoid fire attacks, you can run, use a ward, or bash Alduin with your shield (if he is landed).';
  const claim = 'Unikaj ataków ognia, biegając, używając tarczy lub zaklęcia ochronnego.';
  const payload = wynikModelu(claim, quote);
  payload.claims[0].claim_en = 'Avoid fire attacks by running, using a shield, or a ward.';
  const result = normalizujWynikWalidatora(payload, 'test-model', 'test', new Set(['SOURCE 1']), dane(quote), claim);
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
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

test('gameplay paraphrases preserve attack, shout, landing, and giant zombie-dog concepts across languages', () => {
  const { zgodnoscStrukturalna } = require('../ai/claimValidation');
  const attackQuote = 'Every time he lands, attack him. You will need to use the shout multiple times.';
  const attackClaim = 'Po wylądowaniu atakuj go, powtarzając okrzyk.';
  assert.equal(zgodnoscStrukturalna(attackQuote, attackClaim).ok, true, JSON.stringify(zgodnoscStrukturalna(attackQuote, attackClaim)));

  const dogsQuote = 'The trouble is that two giant zombie dogs are guarding it.';
  const dogsClaim = 'Dwóch gigantycznych zombie-psów strzeże tego miejsca.';
  assert.equal(zgodnoscStrukturalna(dogsQuote, dogsClaim).ok, true, JSON.stringify(zgodnoscStrukturalna(dogsQuote, dogsClaim)));
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

test('short infobox quote fails closed when the claim subject cannot be bound', () => {
  const claim = 'The character has the Rogue class.';
  const quote = 'Class Rogue';
  const result = normalizujWynikWalidatora(
    wynikModelu(claim, quote),
    'test-model',
    'test',
    new Set(['SOURCE 1']),
    dane('Astarion Gender Male Class Rogue Race High Elf'),
    claim,
  );
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /krótki cytat z infoboksu nie wiąże pola z encją claimu/);
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

test('claim_en cannot silently drop an unsupported proper name from the Polish claim', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'Geralt met a stranger.' }]);
  const result = spojnoscTlumaczeniaClaimu('Geralt spotkał Gandalfa.', 'Geralt met a stranger.', { nameOracle });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.reason, /nazwy własne/);
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

  const expandedQuote = 'Wheatley took control of Aperture and destroyed the core.';
  const expandedClaim = spojnoscTlumaczeniaClaimu(
    'Wheatley przejął kontrolę nad Aperture.',
    expandedQuote,
    { evidenceQuote: expandedQuote },
  );
  assert.equal(expandedClaim.ok, false, JSON.stringify(expandedClaim));
  assert.match(expandedClaim.reason, /nie odpowiada treści claimu/);
});

test('claim_en still fails when a source-backed name is dropped from the translation', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'Later, Wheatley took control of the facility.' }]);
  const result = spojnoscTlumaczeniaClaimu('Wheatley przejął kontrolę nad obiektem.', 'He took control of the facility.', { nameOracle });
  assert.equal(result.ok, false);
  assert.match(result.reason, /nazwy własne/);
});

test('Polish claims cannot bypass cross-language checks when English evidence has no claim_en', () => {
  const claim = 'Wheatley przejął kontrolę nad Aperture.';
  const quote = 'Wheatley took control of Aperture.';
  const model = wynikModelu(claim, quote);
  const result = normalizujWynikWalidatora(
    model,
    'test-model',
    'groq',
    new Set(['SOURCE 1']),
    dane(quote),
    claim,
  );

  assert.notEqual(result.status, 'accepted');
  assert.ok(result.diagnostics.localRejectReasons.includes('claim_translation_missing'));
});

test('an inconsistent claim_en is rejected instead of silently ignored', () => {
  const claim = 'Wheatley przejął kontrolę nad Aperture.';
  const quote = 'Wheatley took control of Aperture.';
  const model = wynikModelu(claim, quote);
  model.claims[0].claim_en = 'Wheatley destroyed Aperture.';
  const result = normalizujWynikWalidatora(
    model,
    'test-model',
    'groq',
    new Set(['SOURCE 1']),
    dane(quote),
    claim,
  );

  assert.notEqual(result.status, 'accepted');
  assert.ok(result.diagnostics.localRejectReasons.includes('evidence_not_verified'));
});

