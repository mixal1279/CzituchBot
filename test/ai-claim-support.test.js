'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOverclaimTypes,
  buildClaimSupportAudit,
  summarizeClaimSupportAudits,
} = require('../ai/claim-support');
const { extractClaimSupportAudit } = require('../scripts/ai-live-benchmark');
const validator = require('../ai/validator');
const claimValidation = require('../ai/claimValidation');

test('claim-support audit distinguishes exact entailment, bounded-context partial support, and unsupported evidence', () => {
  const audit = buildClaimSupportAudit({
    claims: [
      { claim: 'Portal 2 was released in 2011.', source_ids: ['SOURCE 1'], evidence_quote: 'Portal 2 was released in 2011.', supported: true },
      { claim: 'Wheatley took control.', source_ids: ['SOURCE 2'], evidence_quote: 'Wheatley took control.', supported: true },
      { claim: 'GLaDOS was created in 1998.', source_ids: ['SOURCE 3'], evidence_quote: 'GLaDOS was created in 1998.', supported: true },
      { claim: 'A claim without a verified quote.', source_ids: ['SOURCE 4'], evidence_quote: 'not present in source', supported: true },
    ],
    evidenceEvaluations: [
      { ok: true, mode: 'exact_quote', reason: 'exact quote' },
      { ok: true, mode: 'source_context', reason: 'bounded context' },
      { ok: false, mode: null, reason: 'sprzeczność liczbowa' },
      { ok: false, mode: null, reason: 'quote missing' },
    ],
    evidenceQuoteVerified: [true, true, true, false],
    evidenceContexts: [
      'Portal 2 was released in 2011.',
      'Wheatley took control.',
      'GLaDOS was created in 1997.',
      'source text',
    ],
  });

  assert.deepEqual(audit.records.map(record => record.verdict), ['entailed', 'partial', 'contradicted', 'unverifiable']);
  assert.equal(audit.claimSupportPassRate, 0.25);
  assert.equal(audit.claimSupportUsableRate, 0.5);
  assert.equal(audit.verdictCounts.contradicted, 1);
  assert.equal(audit.verdictCounts.unverifiable, 1);
  assert.deepEqual(audit.records.map(record => record.claimSourceVerdict), [
    'supported', 'partial', 'contradicted', 'not_enough_evidence',
  ]);
  assert.deepEqual(audit.claimSourceVerdictCounts, {
    supported: 1,
    partial: 1,
    contradicted: 1,
    not_enough_evidence: 1,
    unsupported_by_cited_source: 0,
  });
});

test('claim-support audit retains claim_en for translation diagnostics', () => {
  const audit = buildClaimSupportAudit({
    claims: [{
      claim: 'Astarion dołączył do drużyny.',
      claim_en: 'He joined the party.',
      source_ids: ['SOURCE 1'],
      evidence_quote: 'He joined the party.',
      supported: true,
    }],
    evidenceEvaluations: [{ ok: false, reason: 'claim_en pomija podmiot' }],
    evidenceQuoteVerified: [true],
    evidenceQuotes: ['He joined the party.'],
  });
  assert.equal(audit.records[0].claimEn, 'He joined the party.');
});

test('status epistemiczny można wykrywać wielokrotnie bez wycieku lastIndex regexu', () => {
  const claim = 'GLaDOS is Caroline.';
  const evidence = 'A popular fan theory suggests that GLaDOS is Caroline.';
  for (let i = 0; i < 3; i += 1) {
    assert.ok(detectOverclaimTypes(claim, evidence).includes('speculation_presented_as_fact'));
  }
});

test('claim-support audit flags correlation-to-causation overclaim', () => {
  assert.ok(detectOverclaimTypes(
    'The patch caused the performance increase.',
    'The patch was associated with a performance increase.',
  ).includes('correlation_to_causation'));
});

test('purpose language alone is not treated as proof of a completed causal outcome', () => {
  const claim = 'Wheatley took control because Chell pushed the button.';
  const purposeOnly = 'Chell pushed the button so that Wheatley could take control.';
  const explicitOutcome = 'Chell pushed the button so that Wheatley could take control. Wheatley is put in place, putting him in control of the facility.';
  assert.ok(detectOverclaimTypes(claim, purposeOnly).includes('correlation_to_causation'));
  assert.deepEqual(detectOverclaimTypes(claim, explicitOutcome), []);
});

test('claim-support audit flags a hedge upgraded to an absolute', () => {
  assert.ok(detectOverclaimTypes(
    'The method always guarantees success.',
    'The method may improve the chance of success.',
  ).includes('hedge_to_absolute'));
});

test('a source hedge does not reject an ordinary declarative claim by itself', () => {
  assert.deepEqual(detectOverclaimTypes(
    'The method is effective.',
    'The method may improve the chance of success.',
  ), []);
});

test('a Polish declarative sentence is not absolute merely because it says jest', () => {
  assert.deepEqual(detectOverclaimTypes(
    'Metoda jest skuteczna.',
    'Metoda może poprawić szansę powodzenia.',
  ), []);
});

test('a hedge on one outcome does not reject a claim using a generic reporting verb', () => {
  assert.deepEqual(detectOverclaimTypes(
    'The results show a trend.',
    'The method may reduce latency.',
  ), []);
});

test('a matching hedged outcome cannot be stated as certain without a qualifier', () => {
  assert.ok(detectOverclaimTypes(
    'The method reduces latency.',
    'The method may reduce latency.',
  ).includes('hedge_to_absolute'));
});

test('same-source bounded context can resolve causality only for a locally accepted context-supported claim', () => {
  const claim = 'The transfer caused the outcome.';
  const quote = 'The transfer occurred.';
  const context = 'The transfer occurred, causing the outcome.';
  assert.ok(detectOverclaimTypes(claim, quote).includes('correlation_to_causation'));
  assert.deepEqual(detectOverclaimTypes(claim, quote, { context, allowContextForCausality: true }), []);
  assert.ok(detectOverclaimTypes(claim, quote, { context, allowContextForCausality: false }).includes('correlation_to_causation'));
});

test('English each is recognized as an all-quantifier equivalent', () => {
  assert.deepEqual(detectOverclaimTypes('Each player can use this route.', 'Every player can use this route.'), []);
  assert.ok(detectOverclaimTypes('Each player can use this route.', 'Some players can use this route.').includes('unsupported_quantifier'));
});

test('Polish exclusive quantifier is recognized after normalization', () => {
  assert.ok(detectOverclaimTypes(
    'Wyłącznie gracze z kluczem mogą wejść.',
    'Gracze z kluczem mogą wejść.',
  ).includes('unsupported_quantifier'));
});

test('date ranges do not trigger the dropped upper-bound guard', () => {
  assert.ok(!detectOverclaimTypes(
    'The game was released in 2015.',
    'The studio operated from 2011 to 2015.',
  ).includes('up_to_qualifier_dropped'));
});

test('claim-support audit flags a dropped upper-bound qualifier', () => {
  const types = detectOverclaimTypes(
    'The system improves performance by 30%.',
    'The system may improve performance by up to 30%.',
  );
  assert.ok(types.includes('up_to_qualifier_dropped'));
  assert.ok(types.includes('hedge_to_absolute'));
});

test('claim-support audit flags an unsupported quantifier', () => {
  assert.ok(detectOverclaimTypes(
    'All players choose this route.',
    'Some players choose this route.',
  ).includes('unsupported_quantifier'));
});

test('claim-support audit warns when an old dated source is presented as current', () => {
  assert.ok(detectOverclaimTypes(
    'This is the current result today.',
    'The result was reported in 2021.',
  ).includes('stale_source_as_current'));
});

test('overclaim audit uses the exact cited span rather than unrelated neighboring context', () => {
  const audit = buildClaimSupportAudit({
    claims: [{
      claim: 'The method improves outcomes.',
      source_ids: ['SOURCE 1'],
      evidence_quote: 'The method improves outcomes.',
      supported: true,
    }],
    evidenceEvaluations: [{ ok: true, mode: 'exact_quote', reason: 'exact cited span supports claim' }],
    evidenceQuoteVerified: [true],
    evidenceQuotes: ['The method improves outcomes.'],
    evidenceContexts: [
      'The method improves outcomes. A separate experimental feature may reduce latency.',
    ],
  });

  assert.deepEqual(audit.records[0].overclaimTypes, []);
  assert.equal(audit.records[0].claimSourceVerdict, 'supported');
});

test('live benchmark extracts claim support audits from validator diagnostics', () => {
  const audit = buildClaimSupportAudit({
    claims: [{ claim: 'The game launched in 2011.', source_ids: ['SOURCE 1'], evidence_quote: 'The game launched in 2011.', supported: true }],
    evidenceEvaluations: [{ ok: true, mode: 'exact_quote', reason: 'exact quote' }],
    evidenceQuoteVerified: [true],
    evidenceContexts: ['The game launched in 2011.'],
  });
  const extracted = extractClaimSupportAudit({
    validatorResults: [{ validationDiagnostics: { claimSupport: audit } }],
  });
  assert.equal(extracted.totalClaims, 1);
  assert.equal(extracted.claimSupportPassRate, 1);
  assert.equal(extracted.verdictCounts.entailed, 1);
});

test('aggregate metric preserves per-claim verdicts and overclaim diagnostics', () => {
  const one = buildClaimSupportAudit({
    claims: [
      { claim: 'The system always works.', source_ids: ['SOURCE 1'], evidence_quote: 'The system may work.', supported: true },
      { claim: 'A supported claim.', source_ids: ['SOURCE 2'], evidence_quote: 'A supported claim.', supported: true },
    ],
    evidenceEvaluations: [
      { ok: true, mode: 'exact_quote', reason: 'locally supported' },
      { ok: true, mode: 'exact_quote', reason: 'locally supported' },
    ],
    evidenceQuoteVerified: [true, true],
    evidenceContexts: ['The system may work.', 'A supported claim.'],
  });
  const aggregate = summarizeClaimSupportAudits([one]);

  assert.equal(aggregate.totalClaims, 2);
  assert.equal(aggregate.claimSupportPassRate, 0.5);
  assert.equal(aggregate.verdictCounts.unsupported, 1);
  assert.equal(aggregate.records.length, 2);
  assert.equal(aggregate.overclaimCounts.hedge_to_absolute, 1);
  assert.equal(aggregate.claimSourceVerdictCounts.unsupported_by_cited_source, 1);
});

test('explicit reciprocal exchange supports a reason without excusing unrelated causal claims', () => {
  const polishClaim = 'Geralt zgodził się odnaleźć rodzinę Barona, ponieważ obiecał mu informacje o Ciri w zamian za pomoc.';
  const polishEvidence = 'Geralt zgadza się odnaleźć zaginioną żonę i córkę Barona w zamian za informacje o Ciri.';
  assert.deepEqual(detectOverclaimTypes(polishClaim, polishEvidence), []);

  const englishClaim = "Geralt agreed to find the Baron's missing family because the Baron offered information about Ciri in exchange for the search.";
  const englishEvidence = "Geralt agrees to locate the missing wife and daughter of the Baron in exchange for information about Ciri.";
  assert.deepEqual(detectOverclaimTypes(englishClaim, englishEvidence), []);

  assert.ok(detectOverclaimTypes(
    'The Baron gave Geralt information because Geralt found his family.',
    'Geralt searched for the Baron’s missing family. The Baron had information about Ciri.',
  ).includes('correlation_to_causation'));
});


test('Polish possibility wording preserves a source hedge', () => {
  assert.deepEqual(detectOverclaimTypes(
    'W grze postać tę można spotkać i zrekrutować jako towarzysza.',
    'The character may be encountered and recruited as a companion.',
  ), []);
});

test('an explicit offer-to-join outcome supports a Polish causal connector', () => {
  assert.deepEqual(detectOverclaimTypes(
    'Dzięki temu zostaje zrekrutowany jako towarzysz.',
    'Taking him up on this offer will see him officially join your party.',
  ), []);
});


test('fan theories cannot be promoted to established lore facts', () => {
  assert.ok(detectOverclaimTypes(
    'GLaDOS is Caroline.',
    'A popular fan theory suggests that GLaDOS is Caroline.',
  ).includes('speculation_presented_as_fact'));
  assert.deepEqual(detectOverclaimTypes(
    'A fan theory suggests that GLaDOS is Caroline.',
    'A popular fan theory suggests that GLaDOS is Caroline.',
  ), []);
});

test('interpretations remain labelled and are not converted into plot events', () => {
  assert.ok(detectOverclaimTypes(
    'The ending means that the protagonist is dead.',
    'The ending can be interpreted as suggesting that the protagonist is dead.',
  ).includes('interpretation_presented_as_fact'));
  assert.deepEqual(detectOverclaimTypes(
    'One interpretation is that the protagonist is dead.',
    'The ending can be interpreted as suggesting that the protagonist is dead.',
  ), []);
});

test('canonical status must appear in the cited evidence span', () => {
  assert.ok(detectOverclaimTypes(
    'To wydarzenie jest kanoniczne.',
    'The character appears in the final mission.',
  ).includes('canon_status_not_in_evidence'));
  assert.deepEqual(detectOverclaimTypes(
    'To wydarzenie jest kanoniczne.',
    'This event is part of the official canon.',
  ), []);
});


test('a directly stated symbolic meaning is not misclassified as an unlabeled interpretation', () => {
  assert.deepEqual(detectOverclaimTypes(
    'Czerwony kolor symbolizuje niebezpieczeństwo.',
    'The red color symbolizes danger.',
  ), []);
});

test('ordinary official release wording is not confused with canonical status', () => {
  assert.deepEqual(detectOverclaimTypes(
    'To oficjalna wersja gry.',
    'This is the official game release.',
  ), []);
});


test('negacja teorii fanowskiej nie zmienia potwierdzonego faktu w spekulację', () => {
  assert.deepEqual(detectOverclaimTypes(
    'GLaDOS is Caroline.',
    'This is not a fan theory: the developers confirmed that GLaDOS is Caroline.',
  ), []);
  assert.deepEqual(detectOverclaimTypes(
    'GLaDOS jest Caroline.',
    'To nie jest teoria fanowska; twórcy potwierdzili, że GLaDOS jest Caroline.',
  ), []);
});

test('ogólne słowo theory nie jest automatycznie teorią fanowską', () => {
  assert.deepEqual(detectOverclaimTypes(
    'The theory of the game world is described here.',
    'The theory of the game world explains the timeline.',
  ), []);
});

test('modalna interpretacja nie może zostać zamieniona w kategoryczne znaczenie', () => {
  assert.ok(detectOverclaimTypes(
    'The red color symbolizes danger.',
    'The red color may symbolize danger.',
  ).includes('interpretation_presented_as_fact'));
  assert.deepEqual(detectOverclaimTypes(
    'One interpretation is that the red color symbolizes danger.',
    'The red color may symbolize danger.',
  ), []);
});

test('kanon i niekanoniczność muszą mieć zgodny status w cytowanym dowodzie', () => {
  assert.ok(detectOverclaimTypes(
    'To wydarzenie jest kanoniczne.',
    'This event is non-canonical.',
  ).includes('canon_status_conflict'));
  assert.ok(detectOverclaimTypes(
    'To wydarzenie nie jest kanoniczne.',
    'This event is part of the official canon.',
  ).includes('canon_status_conflict'));
  assert.ok(detectOverclaimTypes(
    'This event is non-canonical.',
    'The character appears in the final mission.',
  ).includes('canon_status_not_in_evidence'));
});


test('wykrywanie statusu pomija zanegowany marker, ale analizuje dalszą część cytatu', () => {
  assert.ok(detectOverclaimTypes(
    'GLaDOS is Caroline.',
    'This is not a fan theory, but fans speculate that GLaDOS is Caroline.',
  ).includes('speculation_presented_as_fact'));
  assert.ok(detectOverclaimTypes(
    'The ending means the protagonist is dead.',
    'This is not an interpretation; it may symbolize the protagonist’s death.',
  ).includes('interpretation_presented_as_fact'));
});

test('sformułowanie „theory suggests” zachowuje status hipotezy', () => {
  assert.ok(detectOverclaimTypes(
    'The facility was built by the founders.',
    'A theory suggests that the facility was built by the founders.',
  ).includes('speculation_presented_as_fact'));
});


test('status kanoniczny wymaga źródła pierwotnego, nie tylko wyspecjalizowanej wiki', () => {
  const input = {
    claims: [{
      claim: 'To wydarzenie jest kanoniczne.',
      source_ids: ['SOURCE 1'],
      evidence_quote: 'This event is part of the official canon.',
      supported: true,
    }],
    evidenceEvaluations: [{ ok: true, mode: 'exact_quote', reason: 'exact quote' }],
    evidenceQuoteVerified: [true],
    evidenceQuotes: ['This event is part of the official canon.'],
  };
  const communityWiki = buildClaimSupportAudit({ ...input, evidenceAuthorities: ['specialized'] });
  assert.equal(communityWiki.records[0].verdict, 'unsupported');
  assert.ok(communityWiki.records[0].overclaimTypes.includes('canon_status_not_official_source'));
  assert.equal(communityWiki.records[0].sourceAuthority, 'specialized');

  const officialSource = buildClaimSupportAudit({ ...input, evidenceAuthorities: ['official'] });
  assert.equal(officialSource.records[0].verdict, 'entailed');
  assert.deepEqual(officialSource.records[0].overclaimTypes, []);
});


test('walidator wiąże status kanoniczny z autorytetem dokładnie cytowanego źródła', () => {
  const claim = 'To wydarzenie jest kanoniczne.';
  const payload = {
    valid: true,
    reason: 'claim poparty cytatem',
    confidence: 0.99,
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    unsupported_claims: [],
    claims: [{
      claim,
      supported: true,
      source_ids: ['SOURCE 1'],
      evidence_quote: claim,
      claim_en: '',
      reason: 'dokładny cytat',
    }],
  };
  const sprawdz = url => validator.normalizujWynikWalidatora(
    payload,
    'test-model',
    'gemini',
    new Set(['SOURCE 1']),
    '[SOURCE 1]\nURL: ' + url + '\nTYTUŁ: Status wydarzenia\nTREŚĆ:\n' + claim,
    claim,
  );

  const wiki = sprawdz('https://gamelore.fandom.com/wiki/Example');
  assert.equal(wiki.diagnostics.claimSupport.records[0].sourceAuthority, 'specialized');
  assert.ok(wiki.diagnostics.hardOverclaimClaimIndexes.includes(0));
  assert.ok(wiki.diagnostics.claimSupport.records[0].overclaimTypes.includes('canon_status_not_official_source'));

  const official = sprawdz('https://www.naughtydog.com/blog/example');
  assert.equal(official.diagnostics.claimSupport.records[0].sourceAuthority, 'official');
  assert.ok(!official.diagnostics.claimSupport.records[0].overclaimTypes.includes('canon_status_not_official_source'));

  const multiSourcePayload = {
    ...payload,
    claims: [{ ...payload.claims[0], source_ids: ['SOURCE 1', 'SOURCE 2'] }],
  };
  const mixed = validator.normalizujWynikWalidatora(
    multiSourcePayload,
    'test-model',
    'gemini',
    new Set(['SOURCE 1', 'SOURCE 2']),
    '[SOURCE 1]\nURL: https://gamelore.fandom.com/wiki/Example\nTYTUŁ: Wiki\nTREŚĆ:\n' + claim
      + '\n[SOURCE 2]\nURL: https://www.naughtydog.com/blog/example\nTYTUŁ: Oficjalne źródło\nTREŚĆ:\n' + claim,
    claim,
  );
  assert.equal(mixed.diagnostics.claimSupport.records[0].sourceAuthority, 'official');
  assert.ok(!mixed.diagnostics.claimSupport.records[0].overclaimTypes.includes('canon_status_not_official_source'));
});

test('oversized optional context cannot bypass the bounded causal evidence check', () => {
  const claim = 'The transfer caused the outcome.';
  const quote = 'The transfer occurred.';
  const oversizedContext = 'The transfer occurred, causing the outcome. ' + 'x'.repeat(2500);

  assert.ok(detectOverclaimTypes(claim, quote, {
    context: oversizedContext,
    allowContextForCausality: true,
  }).includes('correlation_to_causation'));
});

test('adjacent entity names use literal matching with Unicode-safe boundaries', () => {
  assert.equal(claimValidation.czyNazwySasiaduja('Wheatley, Control', 'Wheatley', 'Control'), true);
  assert.equal(claimValidation.czyNazwySasiaduja('SuperWheatley Control', 'Wheatley', 'Control'), false);
  assert.equal(claimValidation.czyNazwySasiaduja('Wheatley Controller', 'Wheatley', 'Control'), false);
  assert.equal(claimValidation.czyNazwySasiaduja('中Wheatley Control', 'Wheatley', 'Control'), false);
  assert.equal(claimValidation.czyNazwySasiaduja('Wheatley Control中', 'Wheatley', 'Control'), false);
});
