'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveGameEntity, containsAlias, externalGameCandidateMatchesQuery } = require('../ai/entities');
const { rerankujWynikiTavily } = require('../ai/tavily');

test('entity resolver still accepts exact and normal Polish inflection matches', () => {
  const exact = resolveGameEntity('Co wydarzyło się w Wiedźminie 3?');
  assert.equal(exact?.name, 'The Witcher 3: Wild Hunt');
  assert.equal(exact?.type, 'game');

  const character = resolveGameEntity('Co Wheatley robi w Portal 2?');
  assert.equal(character?.name, 'Wheatley');
  assert.equal(character?.game, 'Portal 2');
});

test('entity resolver does not treat arbitrary long prefixes as aliases', () => {
  assert.equal(containsAlias('minecraftowo jest fajnie', 'minecraft'), false);
  assert.equal(containsAlias('Wiedźminem grałem wczoraj', 'wiedźmin'), true);
});

test('common character first names stay compatible but expose lower confidence without context', () => {
  const ambiguous = resolveGameEntity('Co robi Arthur?');
  assert.equal(ambiguous?.name, 'Arthur Morgan');
  assert.equal(ambiguous?.resolution, 'deterministic_ambiguous');
  assert.ok(ambiguous?.confidence < 0.9);

  assert.equal(resolveGameEntity('Co robi Arthur w RDR2?')?.name, 'Arthur Morgan');
  assert.equal(resolveGameEntity('Co robi Arthur Morgan?')?.name, 'Arthur Morgan');
  assert.equal(resolveGameEntity('Co robi Ellie w The Last of Us?')?.name, 'Ellie');
});

test('reranking favors relevant authoritative sources over weak generic ones', () => {
  const results = rerankujWynikiTavily([
    {
      score: 0.78,
      url: 'https://example.org/random',
      title: 'Portal 2 - ogólne informacje',
      content: 'Portal 2 to gra. Informacje ogólne.',
    },
    {
      score: 0.74,
      url: 'https://minecraft.wiki/example',
      title: 'Portal 2 Wheatley',
      content: 'Wheatley przejmuje kontrolę nad GLaDOS w Portal 2.',
    },
    {
      score: 0.80,
      url: 'https://example.net/another',
      title: 'Portal 2',
      content: 'Krótka wzmianka o grze bez odpowiedzi na pytanie.',
    },
  ], 'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?');

  assert.match(results[0].url, /minecraft\.wiki/);
});

test('reranking rewards source diversity when scores are close', () => {
  const results = rerankujWynikiTavily([
    {
      score: 0.90,
      url: 'https://example.com/a',
      title: 'Portal 2 lore',
      content: 'Wheatley i GLaDOS Portal 2.',
    },
    {
      score: 0.895,
      url: 'https://example.com/b',
      title: 'Portal 2 lore mirror',
      content: 'Wheatley i GLaDOS Portal 2.',
    },
    {
      score: 0.89,
      url: 'https://example.org/c',
      title: 'Portal 2 lore',
      content: 'Wheatley i GLaDOS Portal 2.',
    },
  ], 'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?');

  assert.match(results[0].url, /example\.com/);
  assert.match(results[1].url, /example\.org/);
});

test('live freshness penalizes clearly stale sources without discarding them', () => {
  const stale = new Date(Date.now() - 120 * 86400000).toISOString();
  const fresh = new Date(Date.now() - 2 * 86400000).toISOString();

  const results = rerankujWynikiTavily([
    {
      score: 0.80,
      url: 'https://example.com/stale',
      title: 'Minecraft news',
      content: 'Minecraft najnowsze informacje.',
      published_date: stale,
    },
    {
      score: 0.79,
      url: 'https://example.org/fresh',
      title: 'Minecraft news',
      content: 'Minecraft najnowsze informacje.',
      published_date: fresh,
    },
  ], 'Minecraft najnowsze informacje', [], { freshness: 'live' });

  assert.match(results[0].url, /example\.org/);
});


test('deterministic resolver wins for explicit Cyberpunk 2077 mentions', () => {
  const resolved = resolveGameEntity('Jaki był związek Johnnyego Silverhanda z Alt Cunningham i jak wpłynęło to na jego konflikt z Arasaką w Cyberpunk 2077?');
  assert.equal(resolved.game, 'Cyberpunk 2077');
  assert.ok(resolved.confidence >= 0.8);
});

test('genitive Johnny Silverhand mention resolves Cyberpunk 2077 without naming the game', () => {
  const question = "Jaki był związek Johnny'ego Silverhanda z Alt Cunningham i jak wpłynęło to na jego konflikt z Arasaką?";
  const resolved = resolveGameEntity(question);
  assert.equal(resolved?.name, 'Johnny Silverhand');
  assert.equal(resolved?.game, 'Cyberpunk 2077');
  assert.equal(externalGameCandidateMatchesQuery(question, 'Cyberpunk 2077').ok, true);
  assert.equal(externalGameCandidateMatchesQuery(question, 'Cyber Daisenryaku').ok, false);
});

test('natural dative Johnny Silverhand inflection resolves correctly', () => {
  const resolved = resolveGameEntity('Jak Johnnemu Silverhandowi pomogła Alt Cunningham?');
  assert.equal(resolved?.name, 'Johnny Silverhand');
  assert.equal(resolved?.game, 'Cyberpunk 2077');
});
