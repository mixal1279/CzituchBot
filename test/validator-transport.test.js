'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.CZITUCHBOT_SKIP_STARTUP_IO = '1';
delete process.env.AI_VALIDATOR_MAX_TOKENS_OPENROUTER;
delete process.env.AI_VALIDATOR_MAX_TOKENS_XKIRO;
delete process.env.AI_VALIDATOR_BREAKER_MS;

const { __validatorTestHooks: hooks } = require('../czituch_bot');
const { createAIRequestContext } = require('../ai/requestContext');
const { resetProviderQuotaCooldowns } = require('../ai/fallback');
const { GROQ_VALIDATOR_JSON_SCHEMA, buildGroqValidatorResponseFormat } = require('../ai/validator');

const EVIDENCE = [
  '[SOURCE 1]',
  'TYTUŁ: Portal 2 release date',
  'URL: https://example.test/portal-2',
  'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
  'Portal 2 was released on 19 April 2011.',
  '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
].join('\n');
const QUESTION = 'When was Portal 2 released?';
const ANSWER = 'Portal 2 was released on 19 April 2011.';
const VALID_VERDICT = {
  valid: true,
  reason: 'The claim is supported by the source.',
  confidence: 0.99,
  unsupported_claims: [],
  ok: true,
  supported: true,
  relevant: true,
  complete: true,
  hallucination: false,
  claims: [{
    claim: ANSWER,
    claim_en: ANSWER,
    supported: true,
    source_ids: ['SOURCE 1'],
    evidence_quote: ANSWER,
    reason: 'Exact source quote.',
  }],
};
const REJECTED_VERDICT = {
  ...VALID_VERDICT,
  valid: false,
  ok: false,
  supported: false,
  confidence: 0.99,
  unsupported_claims: ['Portal 2 was released in 2012.'],
  claims: [{
    claim: 'Portal 2 was released in 2012.',
    claim_en: 'Portal 2 was released in 2012.',
    supported: false,
    source_ids: ['SOURCE 1'],
    evidence_quote: ANSWER,
    reason: 'The date differs from the source.',
  }],
};

const originalFetch = global.fetch;
const oldConfig = {};
function saveConfig() {
  for (const key of ['geminiKey', 'openrouterKey', 'xkiroKey']) oldConfig[key] = hooks.KONFIGURACJA[key];
}
function restoreConfig() {
  for (const [key, value] of Object.entries(oldConfig)) hooks.KONFIGURACJA[key] = value;
  global.fetch = originalFetch;
  hooks.resetValidatorBreakers();
  resetProviderQuotaCooldowns();
  hooks.setGroqClient(null);
}
saveConfig();

test.afterEach(() => {
  restoreConfig();
  saveConfig();
});

function mockFetch(handler) {
  global.fetch = async (url, options = {}) => handler(String(url), options);
}
function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
function openAIResponse(verdict, finishReason = 'stop', model = 'openai/gpt-oss-20b') {
  return {
    model,
    choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(verdict) } }],
    usage: { completion_tokens: 100 },
  };
}
function mockGroq(responseOrFactory) {
  const calls = [];
  hooks.setGroqClient({
    chat: { completions: { create: async (payload, options = {}) => {
      calls.push({ payload, options });
      if (typeof responseOrFactory === 'function') return responseOrFactory(payload, options, calls.length);
      return responseOrFactory;
    } } },
  });
  return calls;
}

test('wspólny prompt zachowuje claim_en, metadane, pytanie, odpowiedź i źródła', () => {
  const meta = { entity: 'Portal 2', intent: 'web_fact' };
  const prompt = hooks.zbudujPromptWalidatora(QUESTION, ANSWER, EVIDENCE, meta);
  assert.match(prompt.system, /claim_en/);
  assert.match(prompt.system, /WYŁĄCZNIE z DANYMI REFERENCYJNYMI/);
  assert.match(prompt.system, /dosłownym, ciągłym fragmentem/);
  assert.match(prompt.user, /<<<REQUEST_META>>>/);
  assert.match(prompt.user, /"entity":"Portal 2"/);
  assert.match(prompt.user, /<<<QUESTION>>>/);
  assert.match(prompt.user, /When was Portal 2 released\?/);
  assert.match(prompt.user, /<<<ANSWER>>>/);
  assert.match(prompt.user, /<<<SOURCES>>>/);
  assert.match(prompt.user, /Portal 2 was released on 19 April 2011/);
});

test('OpenRouter wysyła json_object, reasoning low i domyślny limit 1400; length oznacza ucięty JSON', async () => {
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterValidatorModel = 'openai/gpt-oss-20b';
  let call;
  mockFetch(async (url, options) => {
    call = { url, options, body: JSON.parse(options.body) };
    return jsonResponse({
      model: 'openai/gpt-oss-20b',
      choices: [{ finish_reason: 'length', message: { content: '{"valid":' } }],
    });
  });

  const result = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-or');
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.body.max_tokens, 1400);
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.deepEqual(call.body.reasoning, { effort: 'low', exclude: true });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.truncatedJson, true);
  assert.match(result.reason, /UCIĘTY JSON/);
});

test('xKiro wysyła limit 1600 i json_object; finish_reason length nie jest zwykłym błędem JSON', async () => {
  hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
  hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
  let call;
  mockFetch(async (url, options) => {
    call = { url, options, body: JSON.parse(options.body) };
    return jsonResponse({
      model: 'qwen/qwen3.5-397b-a17b:free',
      choices: [{ finish_reason: 'length', message: { content: '{"valid":' } }],
    });
  });

  const result = await hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, 'test-xk');
  assert.equal(call.url, 'https://api.xkiro.com/v1/chat/completions');
  assert.equal(call.body.max_tokens, 1600);
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.truncatedJson, true);
  assert.match(result.reason, /UCIĘTY JSON/);
});

test('Groq używa klienta mockowanego, payload 2200 tokenów po rezerwie reasoning i zwraca accepted', async () => {
  const calls = mockGroq(openAIResponse(VALID_VERDICT));
  const result = await hooks.walidujOdpowiedzGroq('generic', QUESTION, ANSWER, EVIDENCE, 'test-groq');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.model, 'openai/gpt-oss-20b');
  assert.equal(calls[0].payload.temperature, 0);
  assert.equal(calls[0].payload.max_completion_tokens, 2200);
  assert.equal(calls[0].payload.reasoning_effort, 'low');
  assert.equal(calls[0].payload.response_format.type, 'json_schema');
  assert.equal(calls[0].payload.response_format.json_schema.name, 'czituch_validator');
  assert.equal(calls[0].payload.response_format.json_schema.strict, true);
  assert.deepEqual(calls[0].payload.response_format.json_schema.schema, GROQ_VALIDATOR_JSON_SCHEMA);
  assert.deepEqual(calls[0].payload.response_format, buildGroqValidatorResponseFormat('openai/gpt-oss-20b'));
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.provider, 'groq');
  assert.equal(result.status, 'accepted');
});

test('Groq zwraca rejected dla negatywnego werdyktu i unavailable dla uszkodzonego JSON', async () => {
  mockGroq(openAIResponse(REJECTED_VERDICT));
  const rejected = await hooks.walidujOdpowiedzGroq('generic', QUESTION, ANSWER, EVIDENCE, 'test-groq-rejected');
  assert.equal(rejected.provider, 'groq');
  assert.equal(rejected.status, 'rejected');

  mockGroq(openAIResponse({ malformed: true }));
  const unavailable = await hooks.walidujOdpowiedzGroq('generic', QUESTION, ANSWER, EVIDENCE, 'test-groq-unavailable');
  assert.equal(unavailable.provider, 'groq');
  assert.equal(unavailable.status, 'unavailable');
});

test('kolejność walidatorów to Gemini, Groq, potem dalsze fallbacki; brak prawdziwych żądań sieciowych', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  hooks.KONFIGURACJA.openrouterKey = '';
  hooks.KONFIGURACJA.xkiroKey = '';
  const order = [];
  mockFetch(async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      order.push('gemini');
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'not JSON' }] } }],
      });
    }
    throw new Error('Niezamockowane żądanie sieciowe: ' + url);
  });
  const groqCalls = mockGroq((payload) => {
    order.push('groq');
    return openAIResponse(VALID_VERDICT);
  });
  const requestState = createAIRequestContext({ maxCzasMs: 40000, maxValidators: 4, maxModelCalls: 12 });
  const result = await hooks.walidujOdpowiedzAIBezCache('generic', QUESTION, ANSWER, EVIDENCE, [], 'test-order', requestState, { entity: 'Portal 2' });

  assert.deepEqual(order, ['gemini', 'groq']);
  assert.equal(groqCalls.length, 1);
  assert.equal(result.status, 'accepted');
  assert.deepEqual(requestState.validatorResults.map(row => row.provider), ['gemini', 'groq']);
  assert.ok(requestState.timingTrace.some(row => row.stage === 'validator_provider_start' && row.provider === 'groq'));
  assert.ok(requestState.timingTrace.some(row => row.stage === 'validator_provider_end' && row.provider === 'groq'));
});

test('odrzucenie dotyczące cytatu uruchamia drugą opinię, ale lokalna weryfikacja nadal obowiązuje', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  hooks.KONFIGURACJA.openrouterKey = '';
  hooks.KONFIGURACJA.xkiroKey = '';
  const order = [];
  const badQuoteVerdict = {
    ...VALID_VERDICT,
    claims: [{
      ...VALID_VERDICT.claims[0],
      evidence_quote: 'Portal 2 was released on 19 April 2011 [...]',
      reason: 'Quote is not an exact continuous source span.',
    }],
  };
  mockFetch(async url => {
    if (url.includes('generativelanguage.googleapis.com')) {
      order.push('gemini');
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: JSON.stringify(badQuoteVerdict) }] } }],
      });
    }
    throw new Error('Niezamockowane żądanie sieciowe: ' + url);
  });
  const groqCalls = mockGroq(() => {
    order.push('groq');
    return openAIResponse(VALID_VERDICT);
  });
  const requestState = createAIRequestContext({ maxCzasMs: 40000, maxValidators: 4, maxModelCalls: 12 });
  const result = await hooks.walidujOdpowiedzAIBezCache(
    'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-evidence-second-opinion', requestState, { entity: 'Portal 2' },
  );
  assert.deepEqual(order, ['gemini', 'groq']);
  assert.equal(groqCalls.length, 1);
  assert.equal(result.status, 'accepted');
  assert.deepEqual(requestState.validatorResults.map(row => row.provider), ['gemini', 'groq']);
  assert.ok(requestState.timingTrace.some(row => row.stage === 'validator_second_opinion'));
});

test('circuit breaker dla Groq, xKiro i OpenRouter otwiera się po dwóch timeoutach i resetuje po sukcesie', () => {
  for (const provider of ['groq', 'xkiro', 'openrouter']) {
    hooks.resetValidatorBreakers();
    assert.equal(hooks.validatorBreakerIsOpen(provider), false);
    hooks.recordValidatorTransportResult(provider, { timeoutAbort: true }, 'breaker-test-1');
    assert.equal(hooks.validatorBreakerIsOpen(provider), false);
    hooks.recordValidatorTransportResult(provider, { timeoutAbort: true }, 'breaker-test-2');
    assert.equal(hooks.validatorBreakerIsOpen(provider), true, provider);
    hooks.resetValidatorBreakers();
    hooks.recordValidatorTransportResult(provider, { timeoutAbort: true }, 'breaker-reset-1');
    hooks.recordValidatorTransportResult(provider, { status: 'accepted', timeoutAbort: false }, 'breaker-reset-success');
    assert.equal(hooks.validatorBreakerIsOpen(provider), false, provider);
  }
});

test('timeout z mockowanego klienta Groq trafia do circuit breakera bez wywołania sieci', async () => {
  hooks.KONFIGURACJA.geminiKey = '';
  hooks.KONFIGURACJA.xkiroKey = '';
  hooks.KONFIGURACJA.openrouterKey = '';
  let calls = 0;
  mockGroq(async () => {
    calls++;
    const err = new Error('mock timeout');
    err.name = 'TimeoutError';
    throw err;
  });
  for (let i = 0; i < 2; i++) {
    const result = await hooks.walidujOdpowiedzGroq('generic', QUESTION, ANSWER, EVIDENCE, 'test-groq-timeout-' + i);
    assert.equal(result.status, 'unavailable');
    hooks.recordValidatorTransportResult('groq', result, 'test-groq-timeout-' + i);
  }
  assert.equal(calls, 2);
  assert.equal(hooks.validatorBreakerIsOpen('groq'), true);

  const slotPurposes = [];
  const requestState = createAIRequestContext({ maxCzasMs: 40000, maxValidators: 4, maxModelCalls: 12 });
  const originalReserve = requestState.reserveValidatorModel.bind(requestState);
  requestState.reserveValidatorModel = purpose => {
    slotPurposes.push(purpose);
    return originalReserve(purpose);
  };
  const result = await hooks.walidujOdpowiedzAIBezCache('generic', QUESTION, ANSWER, EVIDENCE, [], 'test-groq-breaker-open', requestState, {});
  assert.ok(!slotPurposes.includes('validator:groq'));
});


test('HTTP circuit breakery xKiro i OpenRouter otwierają się po dwóch mockowanych abortach', async () => {
  for (const provider of ['xkiro', 'openrouter']) {
    hooks.resetValidatorBreakers();
    if (provider === 'xkiro') {
      hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
      hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
    } else {
      hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
    }
    mockFetch(async () => {
      const error = new Error('mocked fetch abort');
      error.name = 'AbortError';
      throw error;
    });
    const invoke = provider === 'xkiro'
      ? () => hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, 'test-' + provider)
      : () => hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-' + provider);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await invoke();
      assert.equal(result.status, 'unavailable');
      assert.equal(result.timeoutAbort, true);
      hooks.recordValidatorTransportResult(provider, result, 'test-' + provider + '-' + attempt);
    }
    assert.equal(hooks.validatorBreakerIsOpen(provider), true, provider);
  }
});
