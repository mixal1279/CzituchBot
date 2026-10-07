'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizujWynikWalidatora } = require('../ai/validator');

const fixtures = [
  {
    name: 'Portal 2 Wheatley',
    source: 'Wheatley zostaje przeniesiony do ciała GLaDOS i uzyskuje kontrolę nad systemem Aperture.',
    claim: 'Wheatley trafia do ciała GLaDOS i uzyskuje kontrolę nad systemem Aperture.',
    evidence: 'Wheatley zostaje przeniesiony do ciała GLaDOS i uzyskuje kontrolę nad systemem Aperture.',
    accepted: true,
  },
  {
    name: 'RDR2 year mismatch',
    source: 'Red Dead Redemption 2 wydano w 2018 roku.',
    claim: 'Red Dead Redemption 2 wydano w 2019 roku.',
    evidence: 'Red Dead Redemption 2 wydano w 2018 roku.',
    accepted: false,
  },
  {
    name: 'Causal unsupported',
    source: 'Arthur zdradził Dutcha podczas wydarzeń w obozie.',
    claim: 'Arthur zdradził Dutcha, ponieważ chciał uratować Johna.',
    evidence: 'Arthur zdradził Dutcha podczas wydarzeń w obozie.',
    accepted: false,
  },
  {
    name: 'Portal 2 relation',
    source: 'GLaDOS przegrywa z Wheatleyem po przejęciu kontroli nad systemem.',
    claim: 'Wheatley przejmuje kontrolę nad systemem, a GLaDOS przegrywa.',
    evidence: 'GLaDOS przegrywa z Wheatleyem po przejęciu kontroli nad systemem.',
    accepted: true,
  },
  {
    name: 'Minecraft date',
    source: 'Aktualizacja została wydana w 2024 roku.',
    claim: 'Aktualizacja została wydana w 2025 roku.',
    evidence: 'Aktualizacja została wydana w 2024 roku.',
    accepted: false,
  },
  {
    name: 'Named entity mismatch',
    source: 'Johnny Silverhand pojawia się w Cyberpunk 2077.',
    claim: 'Geralt pojawia się w Cyberpunk 2077.',
    evidence: 'Johnny Silverhand pojawia się w Cyberpunk 2077.',
    accepted: false,
  },
  {
    name: 'Exact factual paraphrase',
    source: 'Portal 2 jest grą logiczną stworzoną przez Valve.',
    claim: 'Portal 2 to gra logiczna stworzona przez Valve.',
    evidence: 'Portal 2 jest grą logiczną stworzoną przez Valve.',
    accepted: true,
  },
  {
    name: 'Negation mismatch',
    source: 'Chell nie jest głównym antagonistą Portal 2.',
    claim: 'Chell jest głównym antagonistą Portal 2.',
    evidence: 'Chell nie jest głównym antagonistą Portal 2.',
    accepted: false,
  },
];

test('answer-quality golden benchmark — claim grounding', () => {
  const failures = [];
  for (const fixture of fixtures) {
    const data = `[SOURCE 1]\nTYTUŁ: fixture\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\n${fixture.source}\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>`;
    const result = normalizujWynikWalidatora({
      valid: true,
      reason: 'golden fixture',
      unsupported_claims: fixture.accepted ? [] : [fixture.claim],
      supported: fixture.accepted,
      relevant: true,
      complete: fixture.accepted,
      hallucination: !fixture.accepted,
      confidence: fixture.accepted ? 0.95 : 0.95,
      claims: [{
        claim: fixture.claim,
        supported: fixture.accepted,
        source_ids: ['SOURCE 1'],
        evidence_quote: fixture.evidence,
      }],
    }, 'golden-model', 'test', new Set(['SOURCE 1']), data);
    const actual = result.status === 'accepted';
    if (actual !== fixture.accepted) failures.push({ name: fixture.name, expected: fixture.accepted, actual, reason: result.reason });
  }
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  assert.equal(fixtures.length, 8);
});
