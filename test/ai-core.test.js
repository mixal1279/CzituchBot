'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRetrievalPlan,
  assessEvidence,
  scoreSource,
  diversifySources,
  decideEvidencePolicy,
} = require('../ai/core');

test('core retrieval plan preserves entity and creates intent-specific coverage', () => {
  const plan = buildRetrievalPlan(
    'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?',
    { needs_web:true, is_lore:true, game:'Portal 2', entity:'Portal 2' },
    { maxQueries:5 },
  );
  assert.ok(plan.length >= 3);
  assert.ok(plan.some(x => /Portal 2/i.test(x.query)));
  assert.ok(plan.some(x => /lore|plot|story/i.test(x.query)));
});

test('core evidence ranking prefers authoritative relevant evidence', () => {
  const sources = [
    { url:'https://example.org/random', title:'Portal 2', content:'Portal 2 is a game.' },
    { url:'https://minecraft.wiki/portal', title:'Portal 2 Wheatley', content:'Wheatley transfers his core into GLaDOS and takes control of the system.' },
    { url:'https://gamefaqs.gamespot.com/portal', title:'Portal 2 guide', content:'Wheatley and GLaDOS transfer and control.' },
  ];
  const ranked = sources.map((s,i)=>scoreSource(s,'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?',{entity:'Portal 2'}));
  assert.match(diversifySources(ranked,{maxSources:2,minIndependent:2})[0].url,/minecraft\.wiki|gamefaqs\.gamespot\.com/);
});

test('core evidence assessment detects weak single-source evidence', () => {
  const evidence = assessEvidence(
    [{ url:'https://example.org/a', title:'Portal 2', content:'Portal 2 is a game.' }],
    'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?',
    { is_lore:true, game:'Portal 2' },
  );
  assert.equal(evidence.status,'weak');
  assert.equal(evidence.independentHosts,1);
});

test('core policy never disables validation for factual retrieval', () => {
  const policy = decideEvidencePolicy(
    { status:'usable' },
    { intent:'web_fact', needs_fresh_data:false },
  );
  assert.equal(policy.requireValidator,true);
  assert.equal(policy.forbidUnsupportedFacts,true);
  assert.equal(policy.mustAllowPartial,true);
});
