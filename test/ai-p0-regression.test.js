'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdvancedRetrievalPlan,
  normalizujToken,
} = require('../ai/retrieval');
const { scoreSource } = require('../ai/core');
const { createAIRequestContext } = require('../ai/requestContext');
const { createRequestBudget } = require('../ai/limits');
const { createTavilySearch } = require('../ai/tavily');

test('P0 retrieval normalization preserves letters, digits, and collapses whitespace', () => {
  const input = 'Fabuła  GTA 6 i   losy  Artura 2030';
  const normalized = normalizujToken(input);
  assert.match(normalized, /fabula gta 6 i losy artura 2030/);
  assert.doesNotMatch(normalized, /\\s/);
  const plan = buildAdvancedRetrievalPlan(input, {}, [input.replace(/\\s+/g, ' ')]);
  assert.ok(plan.length >= 1);
  assert.equal(plan[0].query, input);
  assert.ok(plan.every(item => !/\\s{2,}/.test(item.query)));
});

test('P0 core source scoring maps Polish authority aliases to canonical values', () => {
  const scored = scoreSource({
    url: 'https://requested-domain.example/article',
    title: 'Portal 2 lore details',
    content: 'Portal 2 lore details and character information.',
    authority: 'wyspecjalizowane',
  }, 'Portal 2 lore');
  assert.equal(scored.authority, 'specialized');
  assert.equal(scored.authorityScore, 0.92);
});

function mockTavilyResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: Array.from({ length: 6 }, (_, i) => ({
        title: `Portal 2 result ${i + 1}`,
        url: `https://same-domain.example/page-${i + 1}`,
        content: `Portal 2 result ${i + 1} contains enough lore information to be useful for retrieval.`,
        score: 0.95,
      })),
    }),
    text: async () => '',
  };
}

test('P0 rewrite budget blocks model call when createAIRequestContext has zero slots', async () => {
  let rewriteCalls = 0;
  const search = createTavilySearch({
    apiKey: 'test-key',
    groq: { chat: { completions: { create: async () => {
      rewriteCalls++;
      return { choices: [{ message: { content: 'Portal 2 complete rewritten lore query' } }] };
    } } } },
    fetchZTimeout: async () => mockTavilyResponse(),
    normalizeQuery: value => String(value || '').trim(),
    logger: { log() {}, warn() {}, error() {} },
    cacheFile: '/tmp/czituchbot-p0-no-cache-context.json',
  });
  const ctx = createAIRequestContext({ maxModelCalls: 0 });
  await search('Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?', {
    requestState: ctx,
    returnMeta: true,
  });
  assert.equal(rewriteCalls, 0);
  assert.equal(ctx.modelCalls, 0);
});

test('P0 rewrite budget supports legacy createRequestBudget reserve interface', async () => {
  let rewriteCalls = 0;
  const search = createTavilySearch({
    apiKey: 'test-key',
    groq: { chat: { completions: { create: async () => {
      rewriteCalls++;
      return { choices: [{ message: { content: 'Portal 2 complete rewritten lore query' } }] };
    } } } },
    fetchZTimeout: async () => mockTavilyResponse(),
    normalizeQuery: value => String(value || '').trim(),
    logger: { log() {}, warn() {}, error() {} },
    cacheFile: '/tmp/czituchbot-p0-no-cache-budget.json',
  });
  const budget = createRequestBudget({ maxModelCalls: 0 });
  await search('Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?', {
    requestState: budget,
    returnMeta: true,
  });
  assert.equal(rewriteCalls, 0);
  assert.equal(budget.modelCalls, 0);
});

test('P0 budget reservation does not fall through after reserveModel returns false', async () => {
  let legacyReserveCalls = 0;
  let rewriteCalls = 0;
  const search = createTavilySearch({
    apiKey: 'test-key',
    groq: { chat: { completions: { create: async () => {
      rewriteCalls++;
      return { choices: [{ message: { content: 'Portal 2 complete rewritten lore query' } }] };
    } } } },
    fetchZTimeout: async () => mockTavilyResponse(),
    normalizeQuery: value => String(value || '').trim(),
    logger: { log() {}, warn() {}, error() {} },
    cacheFile: '/tmp/czituchbot-p0-no-cache-fallthrough.json',
  });
  await search('Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?', {
    requestState: {
      reserveModel: () => false,
      zarezerwujModel: () => { legacyReserveCalls++; return true; },
    },
    returnMeta: true,
  });
  assert.equal(rewriteCalls, 0);
  assert.equal(legacyReserveCalls, 0);
});
