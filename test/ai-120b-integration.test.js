'use strict';

process.env.CZITUCHBOT_SKIP_STARTUP_IO = '1';

const assert = require('node:assert/strict');
const test = require('node:test');

const { zapytajAI } = require('../czituch_bot');
const { defaultBreaker } = require('../ai/breaker-120b');
const {
  getProviderQuotaUntil,
  isProviderQuotaBlocked,
  quotaCooldownMsFromError,
  resetProviderQuotaCooldowns,
} = require('../ai/fallback');

const TPD_MESSAGE =
  'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` '
  + 'on tokens per day (TPD): Limit 200000, Used 199559, Requested 3854. '
  + 'Please try again in 24m34.416s.';

const TPM_MESSAGE =
  'Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): '
  + 'Limit 8000, Used 7012, Requested 1034. Please try again in 5.43s.';

const HIGH_DEMAND_MESSAGE =
  'This model is currently experiencing high demand. Spikes in demand are usually temporary.';

function makeGroqMock(errorMessage) {
  const calls = { '120b': 0, '20b': 0 };
  const client = {
    chat: {
      completions: {
        create: async payload => {
          const model = String(payload?.model || '');
          if (model === 'openai/gpt-oss-120b') {
            calls['120b']++;
            if (errorMessage) {
              throw Object.assign(new Error(errorMessage), { status: 429 });
            }
          }
          if (model === 'openai/gpt-oss-20b') calls['20b']++;
          return {
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          };
        },
      },
    },
  };
  return { client, calls };
}

function makeDeps(errorMessage) {
  const { client, calls } = makeGroqMock(errorMessage);
  let summary = null;
  return {
    calls,
    get summary() { return summary; },
    deps: {
      groq: client,
      searchTavily: async () => null,
      pobierzCzasHLTB: async () => null,
      validateAI: async () => ({
        status: 'unavailable',
        ok: false,
        technicalError: true,
        provider: 'test',
        model: 'test',
        unsupported_claims: [],
        reason: 'test validator',
      }),
      loadMemory: async () => [],
      onSummary: value => { summary = value; },
    },
  };
}

async function runOnce(deps, question = 'Cześć, co słychać?', options = {}) {
  await zapytajAI(
    'benchmark',
    question,
    [],
    'Odpowiadaj krótko.',
    async () => {},
    {
      aiProfile: 'generic',
      memoryUserId: 'ai-benchmark',
      temperature: 0.2,
      max_tokens: 100,
      ...options,
      __testDeps: deps,
    },
  );
}

test.beforeEach(() => {
  resetProviderQuotaCooldowns();
  defaultBreaker.reset();
});

test('TPD 429 przez zapytajAI otwiera breaker z cooldownem z parsera', async () => {
  const harness = makeDeps(TPD_MESSAGE);
  await runOnce(harness.deps);

  const snap = defaultBreaker.snapshot();
  assert.equal(snap.breakerOpen, true, 'breaker powinien być otwarty po TPD');
  const remaining = snap.breakerOpenUntil - Date.now();
  assert.ok(
    remaining >= 24 * 60_000,
    `TPD cooldown powinien być >= 24m, jest ${Math.round(remaining / 1000)}s`,
  );

  assert.equal(harness.calls['120b'], 1, '120B powinno być wywołane dokładnie raz');
  assert.ok(harness.calls['20b'] >= 1, 'fallback 20B powinien zostać użyty');
});

test('breaker i endpoint mają spójny deadline (±100ms)', async () => {
  const harness = makeDeps(TPD_MESSAGE);
  await runOnce(harness.deps);

  const expectedCooldown = quotaCooldownMsFromError(TPD_MESSAGE);
  const breakerUntil = defaultBreaker.snapshot().breakerOpenUntil;
  const endpointUntil = getProviderQuotaUntil('groq:openai/gpt-oss-120b');

  assert.ok(breakerUntil > 0, 'breaker musi mieć ustawiony deadline');
  assert.ok(endpointUntil > 0, 'endpoint musi mieć ustawiony deadline');

  const drift = Math.abs(breakerUntil - endpointUntil);
  const TOLERANCE_MS = 100;
  assert.ok(
    drift <= TOLERANCE_MS,
    `deadline drift ${drift}ms > ${TOLERANCE_MS}ms (breaker=${breakerUntil}, endpoint=${endpointUntil})`,
  );

  const now = Date.now();
  assert.ok(
    breakerUntil - now >= expectedCooldown - TOLERANCE_MS,
    'breaker deadline musi zachować wyliczony cooldown',
  );
  assert.ok(
    endpointUntil - now >= expectedCooldown - TOLERANCE_MS,
    'endpoint deadline musi zachować wyliczony cooldown',
  );
});

test('endpoint 120B jest zablokowany, inne endpointy pozostają dostępne', async () => {
  const harness = makeDeps(TPD_MESSAGE);
  await runOnce(harness.deps);

  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-120b'), true);
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-20b'), false);
  assert.equal(isProviderQuotaBlocked('gemini:gemini-3.8-flash'), false);
  assert.equal(isProviderQuotaBlocked('gemini:gemini-3.5-flash-lite'), false);
  assert.equal(isProviderQuotaBlocked('xkiro:default'), false);
  assert.equal(isProviderQuotaBlocked('openrouter:default'), false);
});

test('kolejny request pomija 120B gdy breaker jest otwarty', async () => {
  const first = makeDeps(TPD_MESSAGE);
  await runOnce(first.deps);
  assert.equal(first.calls['120b'], 1);

  const second = makeDeps(TPD_MESSAGE);
  await runOnce(second.deps);
  assert.equal(
    second.calls['120b'],
    0,
    'breaker otwarty — drugi request nie może próbować 120B',
  );
  assert.ok(second.calls['20b'] >= 1, 'drugi request musi użyć 20B jako fallbacku');
});

test('high demand przy otwartym breakerze nadal pomija 120B', async () => {
  const first = makeDeps(TPD_MESSAGE);
  await runOnce(first.deps);
  assert.equal(defaultBreaker.snapshot().breakerOpen, true, 'TPD musi otworzyć breaker');

  // Nawet jeśli kolejna próba 120B zwróciłaby high demand, otwarty breaker
  // powinien zatrzymać ją przed wywołaniem providera.
  const second = makeDeps(HIGH_DEMAND_MESSAGE);
  await runOnce(second.deps);

  assert.equal(second.calls['120b'], 0, 'otwarty breaker musi pominąć 120B');
  assert.ok(second.calls['20b'] >= 1, 'pipeline powinien przejść do zdrowego fallbacku');
  assert.equal(defaultBreaker.snapshot().breakerOpen, true, 'high demand nie może resetować istniejącego breakera');
});

test('TPM 429 nie otwiera breakera na godziny', async () => {
  const startedAt = Date.now();
  const harness = makeDeps(TPM_MESSAGE);
  await runOnce(harness.deps);

  const snap = defaultBreaker.snapshot();
  assert.equal(snap.breakerOpen, true);
  // Measure from before the request; measuring after it loses elapsed milliseconds.
  const remaining = snap.breakerOpenUntil - startedAt;
  assert.ok(remaining >= 60_000, `TPM floor powinien być >= 60s, jest ${remaining}ms`);
  assert.ok(remaining < 5 * 60_000, `TPM nie może trwać minutami, jest ${remaining}ms`);
});

test('high demand nie otwiera breakera (transient, nie quota)', async () => {
  const harness = makeDeps(HIGH_DEMAND_MESSAGE);
  await runOnce(harness.deps);

  assert.equal(
    defaultBreaker.snapshot().breakerOpen,
    false,
    'high demand powinno być transient — breaker musi zostać zamknięty',
  );
  assert.equal(isProviderQuotaBlocked('groq:openai/gpt-oss-120b'), false);
});

test('zapytajAI używa 25s domyślnie i respektuje override benchmarku 40s', async () => {
  const chat = makeDeps(null);
  await runOnce(chat.deps);
  assert.equal(chat.summary.requestBudget.maxCzasMs, 25000);

  const benchmark = makeDeps(null);
  await runOnce(benchmark.deps, 'Cześć, co słychać?', { maxCzasMs: 40000 });
  assert.equal(benchmark.summary.requestBudget.maxCzasMs, 40000);
});
