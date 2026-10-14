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
const { createTavilySearch, przesunSourceIdsTavily } = require('../ai/tavily');
const { buildQuestionForBot } = require('../scripts/ai-live-benchmark');

test('live benchmark passes the gold case game context to the production pipeline', () => {
  assert.equal(buildQuestionForBot({ question: 'Jak pokonać smoka?', game: 'Skyrim' }), 'Jak pokonać smoka? (kontekst gry: Skyrim)');
  assert.equal(buildQuestionForBot({ question: 'Dlaczego Wheatley przejął kontrolę w Portal 2?', game: 'Portal 2' }), 'Dlaczego Wheatley przejął kontrolę w Portal 2?');
  assert.equal(buildQuestionForBot({ question: 'Pytanie ogólne bez gry' }), 'Pytanie ogólne bez gry');
});

test('P0 retrieval normalization preserves letters, digits, and collapses whitespace', () => {
  const input = 'Fabuła  GTA 6 i   losy  Artura 2030';
  const normalized = normalizujToken(input);
  assert.match(normalized, /fabula gta 6 i losy artura 2030/);
  assert.doesNotMatch(normalized, /\s{2,}/);
  const plan = buildAdvancedRetrievalPlan(input, {}, [input.replace(/\s+/g, ' ')]);
  assert.ok(plan.length >= 1);
  assert.equal(plan[0].query, input.replace(/\s+/g, ' '));
  assert.ok(plan.every(item => !/\s{2,}/.test(item.query)));
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


function mockDistinctTavilyResponse(count = 6) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: Array.from({ length: count }, (_, i) => ({
        title: `Distinct source ${i + 1}`,
        url: `https://source${i + 1}.example/article`,
        content: `Distinct source ${i + 1} contains grounded retrieval details about Portal 2 and its characters.`,
        score: 0.95,
      })),
    }),
    text: async () => '',
  };
}

test('P0-B query rewrite uses createGroqCompletion transport options and reasoning headroom', async () => {
  let capturedPayload;
  let capturedOptions;
  const search = createTavilySearch({
    apiKey: 'test-key',
    groq: { chat: { completions: { create: async (payload, requestOptions) => {
      capturedPayload = payload;
      capturedOptions = requestOptions;
      return { choices: [{ message: { content: 'Portal 2 complete rewritten lore query for Wheatley' } }] };
    } } } },
    fetchZTimeout: async () => mockDistinctTavilyResponse(4),
    normalizeQuery: value => String(value || '').trim(),
    logger: { log() {}, warn() {}, error() {} },
    cacheFile: '/tmp/czituchbot-p0b-rewrite.json',
  });
  await search('Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?', { returnMeta: true });
  assert.ok(capturedPayload);
  assert.equal(capturedPayload.model, 'openai/gpt-oss-20b');
  // The runtime enforces at least 300 answer tokens, then adds the 800-token reasoning headroom.
  assert.equal(capturedPayload.max_completion_tokens, 1100);
  assert.equal(Object.hasOwn(capturedPayload, 'signal'), false);
  assert.ok(capturedOptions.signal instanceof AbortSignal);
});

test('P0-B cache stores canonical SOURCE 1 IDs and applies offsets only at output', async () => {
  let tavilyCalls = 0;
  const search = createTavilySearch({
    apiKey: 'test-key',
    groq: { chat: { completions: { create: async () => { throw new Error('rewrite should be skipped'); } } } },
    fetchZTimeout: async () => { tavilyCalls++; return mockDistinctTavilyResponse(4); },
    normalizeQuery: value => String(value || '').trim(),
    logger: { log() {}, warn() {}, error() {} },
    cacheFile: '/tmp/czituchbot-p0b-cache.json',
  });
  const first = await search('Portal 2 source cache test', { _skipRewrite: true, sourceStartIndex: 4 });
  const second = await search('Portal 2 source cache test', { _skipRewrite: true, sourceStartIndex: 0 });
  const third = await search('Portal 2 source cache test', { _skipRewrite: true, sourceStartIndex: 4, returnMeta: true });
  assert.match(first, /^\[SOURCE 5\]/);
  assert.match(second, /^\[SOURCE 1\]/);
  assert.match(third.text, /^\[SOURCE 5\]/);
  assert.equal(third.sources[0].sourceId, 'SOURCE 5');
  assert.equal(third.cached, true);
  assert.equal(tavilyCalls, 1);
});

test('P0-B concurrent callers share canonical inFlight result but get independent offsets and formats', async () => {
  let tavilyCalls = 0;
  let releaseFetch;
  const pendingFetch = new Promise(resolve => { releaseFetch = resolve; });
  const search = createTavilySearch({
    apiKey: 'test-key',
    groq: { chat: { completions: { create: async () => { throw new Error('rewrite should be skipped'); } } } },
    fetchZTimeout: async () => { tavilyCalls++; await pendingFetch; return mockDistinctTavilyResponse(4); },
    normalizeQuery: value => String(value || '').trim(),
    logger: { log() {}, warn() {}, error() {} },
    cacheFile: '/tmp/czituchbot-p0b-inflight.json',
  });
  const firstPromise = search('Portal 2 inFlight canonical test', { _skipRewrite: true, sourceStartIndex: 0, returnMeta: false });
  const secondPromise = search('Portal 2 inFlight canonical test', { _skipRewrite: true, sourceStartIndex: 4, returnMeta: true });
  await new Promise(resolve => setImmediate(resolve));
  releaseFetch();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(tavilyCalls, 1);
  assert.match(first, /^\[SOURCE 1\]/);
  assert.match(second.text, /^\[SOURCE 5\]/);
  assert.equal(second.sources[0].sourceId, 'SOURCE 5');
});

test('P0-B secondary retrieval keeps a one-to-one mapping between source blocks and metadata', async () => {
  const search = createTavilySearch({
    apiKey: 'test-key',
    exaKey: 'exa-test-key',
    groq: { chat: { completions: { create: async () => { throw new Error('rewrite should be skipped'); } } } },
    fetchZTimeout: async (url) => {
      if (String(url).includes('api.tavily.com')) return mockTavilyResponse();
      if (String(url).includes('api.exa.ai')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { title: 'Secondary source A', url: 'https://secondary-a.example/portal', highlights: ['Independent Portal 2 evidence from secondary provider A.'], score: 0.9 },
              { title: 'Secondary source B', url: 'https://secondary-b.example/portal', highlights: ['Independent Portal 2 evidence from secondary provider B.'], score: 0.88 },
            ],
          }),
          text: async () => '',
        };
      }
      throw new Error('Unexpected provider URL: ' + url);
    },
    normalizeQuery: value => String(value || '').trim(),
    logger: { log() {}, warn() {}, error() {} },
    cacheFile: '/tmp/czituchbot-p0b-secondary.json',
  });
  const result = await search('Portal 2 secondary source mapping test', { _skipRewrite: true, returnMeta: true });
  assert.equal(result.status, 'ok');
  assert.equal(result.sources.length, 6);
  for (let index = 0; index < 6; index++) {
    const sourceId = `SOURCE ${index + 1}`;
    assert.ok(result.text.includes(`[${sourceId}]`), `missing block ${sourceId}`);
    assert.equal(result.sources[index].sourceId, sourceId);
    assert.ok(result.text.includes(`TYTUŁ: ${result.sources[index].title}`));
    assert.ok(result.text.includes(`URL: ${result.sources[index].url}`));
  }
});

test('P0-B source offsets also rebase SOURCE references inside conflict reports', () => {
  const canonical = '[SOURCE 1]\n[SOURCE_CONFLICTS]\n- SOURCE 1 vs SOURCE 2 | preferowane=SOURCE 1\n[/SOURCE_CONFLICTS]';
  const shifted = przesunSourceIdsTavily(canonical, 4);
  assert.match(shifted, /^\[SOURCE 5\]/);
  assert.match(shifted, /SOURCE 5 vs SOURCE 6/);
  assert.match(shifted, /preferowane=SOURCE 5/);
});
