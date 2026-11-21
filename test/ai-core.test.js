'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRetrievalPlan,
  normalizeSource,
  assessEvidence,
  scoreSource,
  diversifySources,
  decideEvidencePolicy,
  classifyAuthority,
  sourceMatchesRequestContext,
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

test('character retrieval requires the requested game context to prevent cross-game evidence mixing', () => {
  const routing = {
    is_lore: true,
    entity_type: 'character',
    game: 'Minecraft',
    resolved_entity: { type: 'character', name: 'Alex', game: 'Minecraft' },
  };

  assert.equal(sourceMatchesRequestContext({
    title: 'Alex - Minecraft',
    content: 'Alex is a player character in Minecraft.',
    url: 'https://minecraft.wiki/w/Alex',
  }, routing), true);

  assert.equal(sourceMatchesRequestContext({
    title: 'Alex - Other Game',
    content: 'Alex is a character in Other Game.',
    url: 'https://example.org/alex',
  }, routing), false);

  assert.equal(sourceMatchesRequestContext({
    title: 'Minecraft',
    content: 'Minecraft is a sandbox game.',
    url: 'https://minecraft.wiki/',
  }, routing), false, 'a game-only page is not enough for a character question');
});

test('Gemini grounding snippet is not promoted to webpage evidence by core normalization', () => {
  const source = normalizeSource({
    provider: 'gemini_google_search',
    title: 'Portal 2 Wheatley',
    url: 'https://example.com/portal-2',
    snippet: 'Wheatley took control after the core transfer.',
    content: '',
  });
  assert.equal(source.content, '');
  const evidence = assessEvidence([source], 'Why did Wheatley take control in Portal 2?', {
    is_lore: true, game: 'Portal 2', entity: 'Wheatley',
  });
  assert.equal(evidence.modelSummarySources, 1);
  assert.equal(evidence.status, 'weak', 'grounding metadata alone is not independent page evidence');
});

test('core evidence assessment detects weak single-source evidence', () => {
  const evidence = assessEvidence(
    [{ url:'https://example.org/a', title:'Portal 2', content:'Portal 2 is a game featuring Wheatley and GLaDOS.' }],
    'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?',
    { is_lore:true, game:'Portal 2' },
  );
  assert.equal(evidence.status,'weak');
  assert.equal(evidence.independentHosts,1);
});

test('authority classification does not treat every Fandom wiki as a primary specialist source', () => {
  assert.equal(classifyAuthority({ url:'https://gamelore.fandom.com/wiki/Hornet' }), 'specialized');
  assert.equal(classifyAuthority({ url:'https://randomgame.fandom.com/wiki/Character' }), 'guide');
  assert.equal(classifyAuthority({ url:'https://theportalwiki.com/wiki/Wheatley' }), 'specialized');
  assert.equal(classifyAuthority({ url:'https://isthereanydeal.com/game/portal-2/info/' }), 'reference');
});

test('one strong official source is usable but is not reported as independent multi-source confirmation', () => {
  const evidence = assessEvidence(
    [{
      url:'https://www.valvesoftware.com/en/',
      title:'Portal 2 Wheatley takes control of GLaDOS',
      content:'Portal 2: Wheatley takes control of GLaDOS after the core transfer in Aperture Science.',
    }],
    'Why did Wheatley take control of GLaDOS in Portal 2?',
    { is_lore:true, game:'Portal 2', entity:'Wheatley' },
  );
  assert.equal(evidence.status, 'usable');
  assert.equal(evidence.singlePrimarySource, true);
  assert.equal(evidence.independentHosts, 1);
  assert.equal(evidence.uniqueHosts, 1);
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


test('game-scoped retrieval rejects sequel-only sources for a specific base-game request', () => {
  const baseGame = {
    is_lore: true,
    game: 'Aetherfall',
    resolved_entity: { type: 'game', name: 'Aetherfall', game: 'Aetherfall' },
  };
  assert.equal(sourceMatchesRequestContext({
    title: 'Aetherfall 2 - GameLore',
    content: 'Aetherfall 2 introduces a new protagonist.',
  }, baseGame), false);
  assert.equal(sourceMatchesRequestContext({
    title: 'Aetherfall II story guide',
    content: 'Aetherfall II follows a different timeline.',
  }, baseGame), false);
  assert.equal(sourceMatchesRequestContext({
    title: 'Aetherfall original game',
    content: 'Aetherfall tells the story of the first expedition.',
  }, baseGame), true);

  const sequel = {
    ...baseGame,
    game: 'Aetherfall 2',
    resolved_entity: { type: 'game', name: 'Aetherfall 2', game: 'Aetherfall 2' },
  };
  assert.equal(sourceMatchesRequestContext({
    title: 'Aetherfall 2 - GameLore',
    content: 'Aetherfall 2 introduces a new protagonist.',
  }, sequel), true);

  const franchise = {
    ...baseGame,
    resolved_entity: { type: 'franchise', name: 'Aetherfall', game: 'Aetherfall' },
  };
  assert.equal(sourceMatchesRequestContext({
    title: 'Aetherfall 2 - GameLore',
    content: 'Aetherfall 2 introduces a new protagonist.',
  }, franchise), true);
});

test('future-dated source metadata cannot receive a freshness bonus', () => {
  const query = 'Portal 2 Wheatley story';
  const source = {
    url: 'https://example.org/portal-2',
    title: 'Portal 2 Wheatley story',
    content: 'Portal 2 Wheatley story and its characters.',
  };
  const baseline = scoreSource(source, query, { freshness: 'recent' });
  const farFuture = scoreSource({
    ...source,
    publishedAt: new Date(Date.now() + 10 * 86400000).toISOString(),
  }, query, { freshness: 'recent' });
  const nearFuture = scoreSource({
    ...source,
    publishedAt: new Date(Date.now() + 12 * 3600000).toISOString(),
  }, query, { freshness: 'recent' });

  assert.equal(farFuture.coreScore, baseline.coreScore);
  assert.ok(nearFuture.coreScore >= baseline.coreScore);
  assert.ok(nearFuture.coreScore - baseline.coreScore <= 0.0001);
});
