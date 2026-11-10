'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchExa, extractTavilyPages, czyPublicznyAdresIP, czyHostMaPubliczneDNS, odczytajOgraniczonyJson, odczytajOgraniczonyTekst } = require('../ai/webRetrieval');

test('IP validation rejects private, reserved and non-global IPv4/IPv6 ranges', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '203.0.113.1',
    '224.0.0.1', '240.0.0.1', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1',
    '2001:db8::1', '2001:20::1', '3fff::1', '::ffff:10.0.0.1',
  ]) assert.equal(czyPublicznyAdresIP(address), false, address);
  assert.equal(czyPublicznyAdresIP('8.8.8.8'), true);
  assert.equal(czyPublicznyAdresIP('2606:4700:4700::1111'), true);
  assert.equal(czyPublicznyAdresIP('::ffff:8.8.8.8'), true);
});


test('oversized declared provider bodies are cancelled before parsing', async () => {
  for (const reader of [odczytajOgraniczonyJson, odczytajOgraniczonyTekst]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('oversized'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = {
      headers: { get: () => '9' },
      body,
    };
    await assert.rejects(() => reader(response, 8), /provider_response_too_large/);
    assert.equal(cancelled, true);
  }
});

test('DNS validation fails closed if any answer is private or lookup fails', async () => {
  assert.equal(await czyHostMaPubliczneDNS('mixed.example', async () => [
    { address: '93.184.216.34', family: 4 }, { address: '10.0.0.8', family: 4 },
  ]), false);
  assert.equal(await czyHostMaPubliczneDNS('public.example', async () => [
    { address: '93.184.216.34', family: 4 },
  ]), true);
  assert.equal(await czyHostMaPubliczneDNS('broken.example', async () => { throw new Error('dns failure'); }), false);
});


test('Tavily extraction bounds raw URL candidates before validation and DNS lookups', async () => {
  let lookupCalls = 0;
  let fetchCalls = 0;
  const urls = Array.from({ length: 30 }, (_, index) => `https://invalid-${index}.example/article`);
  urls.push('https://public.example/should-not-be-checked');
  const pages = await extractTavilyPages({
    apiKey: 'test-key',
    urls,
    lookupFn: async () => {
      lookupCalls += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
    fetchFn: async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    },
  });
  assert.equal(pages.size, 0);
  assert.equal(lookupCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('Tavily extraction treats non-array URL input as empty', async () => {
  let fetchCalls = 0;
  const pages = await extractTavilyPages({
    apiKey: 'test-key',
    urls: 'https://public.example/article',
    fetchFn: async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    },
  });
  assert.equal(pages.size, 0);
  assert.equal(fetchCalls, 0);
});

test('Tavily extraction validates resolved addresses before sending URLs', async () => {
  let fetchCalls = 0;
  const pages = await extractTavilyPages({
    apiKey: 'test-key',
    urls: ['https://private.example/article'],
    lookupFn: async () => [{ address: '169.254.169.254', family: 4 }],
    fetchFn: async () => { fetchCalls++; throw new Error('must not fetch'); },
  });
  assert.equal(pages.size, 0);
  assert.equal(fetchCalls, 0);
});


test('Tavily extract sends only preflight-approved URLs to the fixed provider endpoint without redirects', async () => {
  let requestUrl;
  let requestOptions;
  const pages = await extractTavilyPages({
    apiKey: 'test-key',
    urls: ['https://public.example.com/article'],
    lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchFn: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ results: [{
        url: 'https://public.example.com/article',
        raw_content: 'A'.repeat(100),
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(requestUrl, 'https://api.tavily.com/extract');
  assert.equal(requestOptions.redirect, 'error');
  assert.deepEqual(JSON.parse(requestOptions.body).urls, ['https://public.example.com/article']);
  assert.equal(pages.get('https://public.example.com/article').length, 100);
});

test('bounded JSON reader preserves custom transports exposing both json() and text()', async () => {
  const result = await searchExa({
    apiKey: 'test-key',
    query: 'custom transport',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: [{ title: 'A source', url: 'https://example.com/a', text: 'A sufficiently long source body that should survive the custom transport parser.' }] }),
      text: async () => '',
    }),
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.sources.length, 1);
});

test('provider response bodies are bounded and redirects are disabled', async () => {
  let requestOptions;
  const result = await searchExa({
    apiKey: 'test-key',
    query: 'bounded response',
    fetchFn: async (_url, options) => {
      requestOptions = options;
      return new Response('x'.repeat(512 * 1024 + 1), { status: 200 });
    },
  });
  assert.equal(requestOptions.redirect, 'error');
  assert.equal(result.status, 'error');
  assert.equal(result.error, 'provider_response_too_large');
});


test('Exa uses bounded search settings, domain allowlist and page text as evidence', async () => {
  let requestUrl;
  let requestOptions;
  const result = await searchExa({
    apiKey: 'test-key',
    query: 'Portal 2 Wheatley',
    domains: ['theportalwiki.com'],
    timeoutMs: 2500,
    fetchFn: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ results: [
        {
          title: 'Wheatley',
          url: 'https://theportalwiki.com/wiki/Wheatley',
          score: 0.91,
          highlights: ['Highlight is not full page evidence.'],
          text: 'Wheatley is a personality core in Portal 2. '.repeat(4),
        },
        {
          title: 'Snippet only',
          url: 'https://theportalwiki.com/wiki/Snippet',
          highlights: ['This must not become evidence.'],
        },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(requestUrl, 'https://api.exa.ai/search');
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.redirect, 'error');
  assert.equal(requestOptions.headers['x-api-key'], 'test-key');
  const body = JSON.parse(requestOptions.body);
  assert.equal(body.numResults, 6);
  assert.deepEqual(body.includeDomains, ['theportalwiki.com']);
  assert.equal(result.status, 'ok');
  assert.equal(result.sources.length, 1);
  assert.match(result.sources[0].content, /personality core/);
  assert.doesNotMatch(result.sources[0].content, /Highlight is not full page evidence/);
});

test('Exa nie wykonuje requestu bez klucza API lub zapytania', async () => {
  let calls = 0;
  for (const args of [{ apiKey: '', query: 'Portal 2' }, { apiKey: 'test-key', query: '' }]) {
    const result = await searchExa({
      ...args,
      fetchFn: async () => { calls += 1; throw new Error('request nie powinien wystąpić'); },
    });
    assert.equal(result.status, 'disabled');
  }
  assert.equal(calls, 0);
});
