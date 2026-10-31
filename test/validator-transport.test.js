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
const { normalizeGroqBaseUrl } = require('../ai/provider-runtime');
const { resetProviderQuotaCooldowns, quotaCooldownMsFromError, shouldOpenQuotaCircuit, isProviderQuotaBlocked } = require('../ai/fallback');
const { GROQ_VALIDATOR_JSON_SCHEMA, buildGroqValidatorResponseFormat, buildOpenRouterValidatorResponseFormat } = require('../ai/validator');

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

test('Gemini GenerateContent uses the documented systemInstruction and REST responseSchema fields', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  hooks.KONFIGURACJA.openrouterKey = '';
  hooks.KONFIGURACJA.xkiroKey = '';
  let call;
  mockFetch(async (url, options) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'generativelanguage.googleapis.com') throw new Error('Unexpected provider request: ' + url);
    call = { url, options, body: JSON.parse(options.body) };
    return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_VERDICT) }] } }] });
  });
  const requestState = createAIRequestContext({ maxCzasMs: 40000, maxValidators: 4, maxModelCalls: 12 });
  const result = await hooks.walidujOdpowiedzAIBezCache('generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-schema', requestState, { entity: 'Portal 2' });
  assert.equal(result.status, 'accepted');
  assert.match(call.url, /:generateContent$/);
  assert.ok(call.body.systemInstruction?.parts?.[0]?.text);
  assert.equal(Object.hasOwn(call.body, 'system_instruction'), false);
  assert.equal(Object.hasOwn(call.body.generationConfig, 'temperature'), false);
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(call.body.generationConfig.responseSchema.type, 'OBJECT');
  assert.ok(call.body.generationConfig.responseSchema.properties.claims.items.properties.claim_en);
  assert.equal(Object.hasOwn(call.body.generationConfig, 'responseFormat'), false);
});

test('Gemini zachowuje promptFeedback, gdy prompt jest zablokowany i nie ma kandydatów', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  mockFetch(async () => jsonResponse({
    promptFeedback: {
      blockReason: 'SAFETY',
      safetyRatings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', blocked: true, probability: 'HIGH' },
      ],
    },
  }));

  const result = await hooks.walidujOdpowiedzGeminiModel(
    'gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-prompt-blocked',
  );

  assert.equal(result.status, 'unavailable');
  assert.equal(result.provider, 'gemini');
  assert.equal(result.blockReason, 'SAFETY');
  assert.match(result.reason, /promptFeedback\.blockReason=SAFETY/);
  assert.match(result.reason, /HARM_CATEGORY_DANGEROUS_CONTENT/);
  assert.equal(result.safetyRatings[0].blocked, true);
  assert.equal(result.transient, false);
  assert.equal(result.safetyBlocked, true);
  assert.equal(result.technicalError, false);
});

test('Gemini raportuje brak kandydatów bez promptFeedback jako osobny błąd odpowiedzi', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  mockFetch(async () => jsonResponse({ candidates: [] }));

  const result = await hooks.walidujOdpowiedzGeminiModel(
    'gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-no-candidates',
  );

  assert.equal(result.status, 'unavailable');
  assert.equal(result.provider, 'gemini');
  assert.match(result.reason, /nie zwrócił kandydatów/);
  assert.match(result.reason, /nie podał promptFeedback\.blockReason/);
  assert.equal(Object.hasOwn(result, 'blockReason'), false);
  assert.equal(result.transient, false);
  assert.equal(result.safetyBlocked, undefined);
  assert.equal(result.technicalError, true);
});

test('Gemini zachowuje finishReason i safetyRatings, gdy kandydat nie zawiera tekstu', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  mockFetch(async () => jsonResponse({
    candidates: [{
      finishReason: 'SAFETY',
      finishMessage: 'Candidate blocked by safety filters',
      content: { parts: [] },
      safetyRatings: [
        { category: 'HARM_CATEGORY_HARASSMENT', blocked: true, probability: 'HIGH' },
      ],
    }],
  }));

  const result = await hooks.walidujOdpowiedzGeminiModel(
    'gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-candidate-safety',
  );

  assert.equal(result.status, 'unavailable');
  assert.equal(result.finishReason, 'SAFETY');
  assert.equal(result.finishMessage, 'Candidate blocked by safety filters');
  assert.match(result.reason, /finishReason=SAFETY/);
  assert.match(result.reason, /HARM_CATEGORY_HARASSMENT/);
  assert.equal(result.safetyRatings[0].blocked, true);
  assert.equal(result.transient, false);
  assert.equal(result.safetyBlocked, true);
  assert.equal(result.technicalError, false);
});

test('Gemini oznacza niekompletny JSON jako ucięty, gdy finishReason to MAX_TOKENS', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  mockFetch(async () => jsonResponse({
    candidates: [{
      finishReason: 'MAX_TOKENS',
      content: { parts: [{ text: '{"status":"accepted",' }] },
      safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', blocked: false, probability: 'NEGLIGIBLE' }],
    }],
  }));

  const result = await hooks.walidujOdpowiedzGeminiModel(
    'gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-max-tokens',
  );

  assert.equal(result.status, 'unavailable');
  assert.equal(result.finishReason, 'MAX_TOKENS');
  assert.equal(result.truncatedJson, true);
  assert.match(result.reason, /finishReason=MAX_TOKENS/);
});

test('OpenRouter wysyła strict json_schema, wymaga obsługi parametrów i honoruje własny endpoint', async () => {
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterBaseUrl = 'https://openrouter.example/custom/v1';
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
  assert.equal(call.url, 'https://openrouter.example/custom/v1/chat/completions');
  assert.equal(call.body.max_tokens, 1400);
  assert.deepEqual(call.body.response_format, buildOpenRouterValidatorResponseFormat());
  assert.deepEqual(call.body.provider, { require_parameters: true });
  assert.deepEqual(call.body.reasoning, { effort: 'low', exclude: true });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.truncatedJson, true);
  assert.match(result.reason, /UCIĘTY JSON/);
});

test('xKiro wysyła limit 1600 i json_object oraz honoruje własny endpoint', async () => {
  hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
  hooks.KONFIGURACJA.xkiroBaseUrl = 'https://xkiro.example/custom/v1';
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
  assert.equal(call.url, 'https://xkiro.example/custom/v1/chat/completions');
  assert.equal(call.body.max_tokens, 1600);
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.truncatedJson, true);
  assert.match(result.reason, /UCIĘTY JSON/);
});

test('xKiro validator preserves daily free-token exhaustion details when setting 429 cooldown', async () => {
  hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
  hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
  let calls = 0;
  mockFetch(async () => {
    calls++;
    return jsonResponse({
      error: {
        message: 'Free tokens per day (TPD) exhausted',
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
      },
    }, 429);
  });

  const originalNow = Date.now;
  try {
    const result = await hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, 'test-xk-daily-quota');
    assert.equal(result.status, 'unavailable');
    assert.equal(calls, 1);

    // A burst cooldown is 60 seconds by default. Moving forward two minutes
    // proves that the daily quota response was retained as a 24-hour cooldown.
    Date.now = () => originalNow() + 2 * 60 * 1000;
    const skipped = await hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, 'test-xk-daily-quota-cooldown');
    assert.equal(skipped.status, 'unavailable');
    assert.equal(skipped.skipped, true);
    assert.equal(calls, 1, 'daily quota cooldown must prevent another request');
  } finally {
    Date.now = originalNow;
  }
});

test('xKiro validator wall-clock timeout settles at the enforced six-second floor even if fetch ignores AbortSignal', async () => {
  hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
  hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
  const previousTimeout = process.env.AI_XKIRO_VALIDATOR_TIMEOUT_MS;
  process.env.AI_XKIRO_VALIDATOR_TIMEOUT_MS = '30';
  let capturedSignal;
  mockFetch(async (_url, options) => {
    capturedSignal = options.signal;
    // Simulate a transport/mock that never settles after cancellation.
    return new Promise(() => {});
  });
  const started = Date.now();
  try {
    const result = await hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, 'test-xkiro-timeout-race');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.timeoutAbort, true);
    assert.equal(capturedSignal.aborted, true);
    assert.ok(Date.now() - started < 6500, 'wall-clock timeout should settle at the enforced six-second floor rather than wait for a never-settling fetch');
  } finally {
    if (previousTimeout === undefined) delete process.env.AI_XKIRO_VALIDATOR_TIMEOUT_MS;
    else process.env.AI_XKIRO_VALIDATOR_TIMEOUT_MS = previousTimeout;
  }
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
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'generativelanguage.googleapis.com') {
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

test('niepoprawny cytat kończy walidację bez drugiej opinii, bo wymaga naprawy odpowiedzi', async () => {
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
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'https:' && parsedUrl.hostname === 'generativelanguage.googleapis.com') {
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
  assert.deepEqual(order, ['gemini']);
  assert.equal(groqCalls.length, 0);
  assert.equal(result.status, 'rejected');
  assert.deepEqual(requestState.validatorResults.map(row => row.provider), ['gemini']);
  assert.ok(!requestState.timingTrace.some(row => row.stage === 'validator_second_opinion'));
});

test('po deterministycznym odrzuceniu cytatu pipeline nie zużywa budżetu na kolejne opinie', async () => {
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
  hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
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
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'https:' && parsedUrl.hostname === 'generativelanguage.googleapis.com') {
      order.push('gemini');
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(badQuoteVerdict) }] } }] });
    }
    order.push(url.includes('xkiro') ? 'xkiro' : 'openrouter');
    throw new Error('slow third opinion should not be called after Groq rejection');
  });
  mockGroq(() => {
    order.push('groq');
    return openAIResponse(badQuoteVerdict);
  });
  const requestState = createAIRequestContext({ maxCzasMs: 40000, maxValidators: 4, maxModelCalls: 12 });
  const result = await hooks.walidujOdpowiedzAIBezCache(
    'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-stop-after-groq-rejection', requestState, { entity: 'Portal 2' },
  );
  assert.equal(result.status, 'rejected');
  assert.deepEqual(order, ['gemini']);
  assert.deepEqual(requestState.validatorResults.map(row => row.provider), ['gemini']);
});

test('circuit breaker dla Groq, xKiro, OpenRouter i Gemini otwiera się po dwóch timeoutach i resetuje po sukcesie', () => {
  for (const provider of ['groq', 'xkiro', 'openrouter', 'gemini']) {
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

test('timeout z mockowanego klienta Groq trafia do circuit breakera bez wywołania sieci', async t => {
  const previousTpmGuard = process.env.AI_GROQ_TPM_GUARD;
  t.after(() => {
    if (previousTpmGuard === undefined) delete process.env.AI_GROQ_TPM_GUARD;
    else process.env.AI_GROQ_TPM_GUARD = previousTpmGuard;
  });
  process.env.AI_GROQ_TPM_GUARD = '0';
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


test('tymczasowy HTTP 429 nie otwiera godzinnego circuit breakera 120B, dzienna quota tak', () => {
  assert.equal(shouldOpenQuotaCircuit('HTTP 429 rate limit exceeded Retry-After=5s'), false);
  assert.equal(shouldOpenQuotaCircuit('HTTP 429 rate limit exceeded on tokens per day (TPD). Try again in 1h'), true);
  assert.equal(shouldOpenQuotaCircuit('HTTP 402 Prepay credit balance is depleted'), true);
  assert.equal(shouldOpenQuotaCircuit('HTTP 402 openrouter_in_flight_budget Retry-After=5s'), false);
});

test('HTTP 402 ignoruje Retry-After poza udokumentowanym OpenRouter in-flight budget', () => {
  assert.equal(quotaCooldownMsFromError({ status: 402, message: 'HTTP 402 Retry-After=5s' }), 24 * 60 * 60 * 1000);
  assert.equal(quotaCooldownMsFromError({
    status: 402,
    message: 'HTTP 402 openrouter_in_flight_budget Retry-After=5s',
    allowPaymentRequiredRetryAfter: true,
  }), 5000);
});

test('Retry-After ma pierwszeństwo przed domyślnym cooldownem przeciążenia', () => {
  assert.equal(quotaCooldownMsFromError({ status: 429, message: 'HTTP 429 overloaded Retry-After=5s' }), 5000);
  assert.equal(quotaCooldownMsFromError({ status: 429, message: 'HTTP 429 overloaded' }), 60000);
});

test('OpenRouter 402 openrouter_key_limit respektuje reset i blokuje inne modele', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterBaseUrl = 'https://openrouter.example/custom/v1';
  const resetsAt = new Date(Date.now() + 60_000).toISOString();
  mockFetch(async () => ({
    ok: false,
    status: 402,
    headers: { get: () => null },
    json: async () => ({
      error: {
        code: 402,
        message: 'API key credit limit exhausted',
        metadata: { limit_source: 'openrouter_key_limit', resets_at: resetsAt },
      },
    }),
  }));

  const result = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-key-limit-402');
  assert.equal(result.quota, true);
  assert.equal(result.transient, false);
  assert.equal(hooks.isProviderQuotaBlocked('openrouter:another-model'), true);
  assert.equal(hooks.isProviderQuotaBlocked('openrouter:another-model', Date.now() + 61_000), false);
});

test('Gemini Retry-After nie jest wydłużany przez wcześniejszy ogólny cooldown transportu', async () => {
  resetProviderQuotaCooldowns();
  hooks.resetValidatorBreakers();
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  hooks.KONFIGURACJA.openrouterKey = '';
  hooks.KONFIGURACJA.xkiroKey = '';
  let status = 503;
  mockFetch(async () => ({
    ok: false,
    status,
    headers: { get: name => name.toLowerCase() === 'retry-after' && status === 429 ? '5' : null },
    json: async () => ({ error: { message: status === 503 ? 'temporary server error' : 'rate limit exceeded' } }),
  }));

  const transient = await hooks.walidujOdpowiedzGeminiModel('gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-transient-before-429');
  assert.equal(transient.transient, true);
  assert.equal(hooks.isGeminiValidatorCoolingDown(), true);

  status = 429;
  const limited = await hooks.walidujOdpowiedzGeminiModel('gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-short-retry-after');
  assert.equal(limited.quota, true);
  assert.equal(hooks.isGeminiValidatorCoolingDown(), false);
  assert.equal(hooks.isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite', Date.now() + 4_000), true);
  assert.equal(hooks.isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite', Date.now() + 6_000), false);
});

test('OpenRouter honoruje reset 403 budget limit i blokuje dalsze modele tej samej integracji', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterBaseUrl = 'https://openrouter.example/custom/v1';
  const resetsAt = new Date(Date.now() + 60_000).toISOString();
  let calls = 0;
  mockFetch(async () => {
    calls += 1;
    return {
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({
        error: {
          code: 403,
          message: 'Org member budget limit exceeded',
          metadata: {
            limit_source: 'openrouter_workspace_budget',
            remedy_hint: 'Wait for the budget window to reset.',
            resets_at: resetsAt,
          },
        },
      }),
    };
  });

  const result = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-budget-403');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.quota, true);
  assert.equal(result.transient, false);
  assert.match(result.reason, /budget limit/);
  assert.equal(calls, 1);
  assert.equal(hooks.isProviderQuotaBlocked('openrouter:another-model'), true);
  assert.equal(hooks.isProviderQuotaBlocked('openrouter:another-model', Date.now() + 61_000), false);
});

test('Gemini i Groq honorują Retry-After dostawcy', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  hooks.KONFIGURACJA.openrouterKey = '';
  hooks.KONFIGURACJA.xkiroKey = '';
  mockFetch(async () => ({ ok: false, status: 429, headers: { get: name => name.toLowerCase() === 'retry-after' ? '45' : null }, json: async () => ({ error: { message: 'temporary provider error' } }) }));
  const gemini = await hooks.walidujOdpowiedzGeminiModel('gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-retry-after');
  assert.equal(gemini.quota, true);
  assert.equal(gemini.status, 'unavailable');
  assert.equal(hooks.isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite'), true);
  assert.equal(hooks.isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite', Date.now() + 44_000), true);
  assert.equal(hooks.isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite', Date.now() + 46_000), false);

  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.geminiKey = '';
  let groqCalls = 0;
  hooks.setGroqClient({ chat: { completions: { create: async () => {
    groqCalls += 1;
    const error = new Error('rate limit exceeded');
    error.status = 429;
    error.headers = new Headers({ 'retry-after': '45' });
    throw error;
  } } } });
  const groq = await hooks.walidujOdpowiedzGroq('generic', QUESTION, ANSWER, EVIDENCE, 'test-groq-retry-after');
  assert.equal(groq.quota, true);
  assert.equal(groq.status, 'unavailable');
  assert.equal(groqCalls, 1);
  assert.equal(hooks.isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), true);
  assert.equal(hooks.isProviderQuotaBlocked('groq:openai/gpt-oss-20b', Date.now() + 44_000), true);
  assert.equal(hooks.isProviderQuotaBlocked('groq:openai/gpt-oss-20b', Date.now() + 46_000), false);
});

test('Gemini i Groq klasyfikują HTTP 402 jako trwały problem kredytów', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.geminiKey = 'test-gemini-key';
  hooks.KONFIGURACJA.openrouterKey = '';
  hooks.KONFIGURACJA.xkiroKey = '';
  mockFetch(async () => ({ ok: false, status: 402, headers: { get: () => null }, json: async () => ({ error: { message: 'Prepay credit balance is depleted' } }) }));
  const gemini = await hooks.walidujOdpowiedzGeminiModel('gemini-3.5-flash-lite', 'generic', QUESTION, ANSWER, EVIDENCE, [], 'test-gemini-402');
  assert.equal(gemini.status, 'unavailable');
  assert.equal(gemini.quota, true);
  assert.equal(gemini.transient, false);
  assert.equal(hooks.isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite'), true);

  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.geminiKey = '';
  let groqCalls = 0;
  hooks.setGroqClient({ chat: { completions: { create: async () => {
    groqCalls += 1;
    const error = new Error('Payment Required');
    error.status = 402;
    throw error;
  } } } });
  const groq = await hooks.walidujOdpowiedzGroq('generic', QUESTION, ANSWER, EVIDENCE, 'test-groq-402');
  assert.equal(groq.status, 'unavailable');
  assert.equal(groq.quota, true);
  assert.equal(groq.transient, false);
  assert.equal(groqCalls, 1);
  assert.equal(hooks.isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), true);
  const second = await hooks.walidujOdpowiedzGroq('generic', QUESTION, ANSWER, EVIDENCE, 'test-groq-402-second');
  assert.equal(second.skipped, true);
  assert.equal(groqCalls, 1);
});

test('xKiro i OpenRouter honorują 402/429 cooldown i Retry-After bez kolejnych żądań', async () => {
  for (const provider of ['xkiro', 'openrouter']) {
    for (const status of [402, 429]) {
      resetProviderQuotaCooldowns();
      hooks.KONFIGURACJA.xkiroKey = provider === 'xkiro' ? 'test-xkiro-key' : '';
      hooks.KONFIGURACJA.openrouterKey = provider === 'openrouter' ? 'test-openrouter-key' : '';
      hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
      hooks.KONFIGURACJA.openrouterValidatorModel = 'openai/gpt-oss-20b';
      let calls = 0;
      mockFetch(async () => {
        calls += 1;
        return { ok: false, status, headers: { get: name => name.toLowerCase() === 'retry-after' ? (status === 429 ? '30' : null) : null }, json: async () => ({ error: { message: status === 402 ? 'insufficient quota' : 'rate limit exceeded', code: status } }) };
      });
      const invoke = provider === 'xkiro'
        ? () => hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, `test-${provider}-${status}`)
        : () => hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, `test-${provider}-${status}`);
      const first = await invoke();
      assert.equal(first.status, 'unavailable');
      assert.equal(first.quota, true);
      assert.equal(first.transient, status === 429);
      assert.equal(calls, 1);
      const second = await invoke();
      assert.equal(second.skipped, true);
      assert.equal(calls, 1, `${provider} HTTP ${status} must be cooled down rather than retried on every request`);
    }
  }
});

test('OpenRouter retries HTTP 402 only for documented in-flight budget with Retry-After', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterValidatorModel = 'openai/gpt-oss-20b';
  let calls = 0;
  mockFetch(async () => {
    calls += 1;
    return { ok: false, status: 402, headers: { get: name => name.toLowerCase() === 'retry-after' ? '30' : null }, json: async () => ({ error: { message: 'in-flight budget exhausted', code: 402, metadata: { limit_source: 'openrouter_in_flight_budget' } } }) };
  });
  const first = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-inflight');
  assert.equal(first.status, 'unavailable');
  assert.equal(first.quota, true);
  assert.equal(first.transient, true);
  assert.equal(calls, 1);
  const second = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-inflight');
  assert.equal(second.skipped, true);
  assert.equal(calls, 1);
});

test('OpenRouter treats documented HTTP 529 overloaded as transient', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterValidatorModel = 'openai/gpt-oss-20b';
  mockFetch(async () => ({
    ok: false,
    status: 529,
    headers: { get: () => null },
    json: async () => ({ error: { message: 'provider overloaded', code: 529 } }),
  }));
  const result = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-529');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.quota, false);
  assert.equal(result.transient, true);
});

test('120B quota uses a true rolling one-hour window instead of resetting at the hour boundary', () => {
  hooks.resetModel120BGlobalQuotaForTests();
  const { maxRequests, windowMs } = hooks.getModel120BGlobalQuotaForTests();
  const start = 1_000_000;
  for (let i = 0; i < maxRequests; i++) {
    assert.equal(hooks.reserveModel120BForTests('rolling-window-test', start + windowMs - 1000 + i), true);
  }
  const snapshot = hooks.getModel120BGlobalQuotaForTests();
  assert.equal(snapshot.requests, maxRequests);
  // Crossing the process's old hourly boundary must not reset recent requests.
  assert.equal(hooks.reserveModel120BForTests('rolling-window-test', start + windowMs + 1000), false);
  // Once the oldest timestamp is truly one hour old, exactly one slot frees up.
  assert.equal(hooks.reserveModel120BForTests('rolling-window-test', start + 2 * windowMs - 1000), true);
  assert.equal(hooks.getModel120BGlobalQuotaForTests().requests, maxRequests);
  hooks.resetModel120BGlobalQuotaForTests();
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

test('normalizeGroqBaseUrl supplies the canonical default and trims trailing slashes', () => {
  assert.equal(normalizeGroqBaseUrl(), 'https://api.groq.com/openai/v1');
  assert.equal(normalizeGroqBaseUrl(' https://api.groq.com/openai/v1/// '), 'https://api.groq.com/openai/v1');
});

test('normalizeGroqBaseUrl collapses duplicate OpenAI API suffixes without changing proxy paths', () => {
  assert.equal(
    normalizeGroqBaseUrl('https://api.groq.com/openai/v1/openai/v1'),
    'https://api.groq.com/openai/v1',
  );
  assert.equal(normalizeGroqBaseUrl('https://proxy.example/v1'), 'https://proxy.example/v1');
});

test('OpenRouter validator timeout covers a body read that ignores AbortSignal', async () => {
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterValidatorModel = 'openai/gpt-oss-20b';
  let capturedSignal;
  mockFetch(async (_url, options) => {
    capturedSignal = options.signal;
    return {
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    };
  });

  const started = Date.now();
  const result = await hooks.walidujOdpowiedzOpenRouter(
    'generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-body-timeout',
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.timeoutAbort, true);
  assert.equal(capturedSignal.aborted, true);
  assert.ok(Date.now() - started < 7000, 'body-read deadline should settle within the configured six-second default');
});

test('xKiro is attempted below the former 14.5s hard threshold when the calculated budget permits it', async () => {
  hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
  hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
  let calls = 0;
  mockFetch(async () => {
    calls++;
    return jsonResponse({
      model: 'qwen/qwen3.5-397b-a17b:free',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(VALID_VERDICT) } }],
    });
  });
  const requestState = createAIRequestContext({ maxCzasMs: 40000, maxValidators: 4, maxModelCalls: 12 });
  requestState.remainingMs = () => 14000;
  requestState.validationPass = 2;
  requestState.validatory = 0;
  requestState.maxValidatorow = 4;

  const result = await hooks.walidujOdpowiedzXKiro(
    'generic', QUESTION, ANSWER, EVIDENCE, 'test-xkiro-budget-cliff', requestState,
  );
  assert.equal(calls, 1, 'xKiro should not be skipped solely due to the former 14.5s threshold');
  assert.equal(result.status, 'accepted');
});



test('xKiro auth failures open a provider-scoped cooldown and are not retried on each request', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.xkiroKey = 'test-xkiro-key';
  hooks.KONFIGURACJA.xkiroModel = 'qwen/qwen3.5-397b-a17b:free';
  let calls = 0;
  mockFetch(async () => {
    calls += 1;
    return jsonResponse({ error: { message: 'invalid API key', type: 'authentication_error', code: 'invalid_api_key' } }, 401);
  });

  const first = await hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, 'test-xkiro-auth-cooldown');
  assert.equal(first.status, 'unavailable');
  assert.equal(first.statusCode, 401);
  assert.equal(first.quota, false);
  assert.equal(isProviderQuotaBlocked('xkiro:qwen/qwen3.5-397b-a17b:free'), true);

  const second = await hooks.walidujOdpowiedzXKiro('generic', QUESTION, ANSWER, EVIDENCE, 'test-xkiro-auth-cooldown-repeat');
  assert.equal(second.skipped, true);
  assert.equal(calls, 1);
});

test('OpenRouter empty successful responses cool down only the selected model endpoint', async () => {
  resetProviderQuotaCooldowns();
  hooks.KONFIGURACJA.openrouterKey = 'test-openrouter-key';
  hooks.KONFIGURACJA.openrouterValidatorModel = 'openai/gpt-oss-20b';
  let calls = 0;
  mockFetch(async () => {
    calls += 1;
    return jsonResponse({ model: 'openai/gpt-oss-20b', choices: [{ finish_reason: 'stop', message: { content: '' } }] });
  });

  const first = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-empty-cooldown');
  assert.equal(first.status, 'unavailable');
  assert.match(first.reason, /pusty content/);
  assert.equal(isProviderQuotaBlocked('openrouter:openai/gpt-oss-20b'), true);
  assert.equal(isProviderQuotaBlocked('openrouter:openai/gpt-oss-120b'), false);

  const second = await hooks.walidujOdpowiedzOpenRouter('generic', QUESTION, ANSWER, EVIDENCE, 'test-openrouter-empty-cooldown-repeat');
  assert.equal(second.skipped, true);
  assert.equal(calls, 1);
});
