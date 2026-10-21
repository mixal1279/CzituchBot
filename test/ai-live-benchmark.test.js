'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeFactText, scoreGoldenFacts } = require('../ai/benchmark-scorer');
const { buildQuestionForBot, evaluateBenchmarkAnswer, classifyBenchmarkOutcome, buildBenchmarkDiagnostics, stratifiedCases, isFailureText, writeBenchmarkReport, writeStdoutAndWait, wybierzOdrzuconaOdpowiedz } = require('../scripts/ai-live-benchmark');

test('benchmark factual normalization preserves words with Polish diacritics and collapses whitespace', () => {
  assert.equal(normalizeFactText('Święty Łukasz  —  przejął kontrolę.'), 'swiety lukasz przejal kontrole');
});

test('live benchmark anchors the game before the question instead of after its question mark', () => {
  assert.equal(buildQuestionForBot({ game: 'Skyrim', question: 'Jak pokonać smoka?' }), 'W grze Skyrim: Jak pokonać smoka?');
  assert.equal(buildQuestionForBot({ game: 'Portal 2', question: 'Dlaczego Wheatley przejął kontrolę nad GLaDOS?' }), 'W grze Portal 2: Dlaczego Wheatley przejął kontrolę nad GLaDOS?');
});

test('live benchmark does not duplicate a game already named in the question', () => {
  assert.equal(buildQuestionForBot({ game: 'Skyrim', question: 'Jak pokonać smoka w Skyrim?' }), 'Jak pokonać smoka w Skyrim?');
});

test('gold facts require normalized whole phrases, not accidental substrings', () => {
  const facts = { independentGold: true, mustInclude: [['Wheatley', 'przejął kontrolę']], mustNot: ['GLaDOS nie została wyłączona'] };
  assert.equal(scoreGoldenFacts('Wheatley przejął kontrolę nad GLaDOS.', facts).passed, true);
  const falsePositive = scoreGoldenFacts('Wheatley przejął kontrolowanie; ślad kontrolowania pozostał.', facts);
  assert.equal(falsePositive.passed, false);
  assert.deepEqual(falsePositive.missing, [['Wheatley', 'przejął kontrolę']]);
});

test('forbidden golden facts reduce factual score and are detected after normalization', () => {
  const result = scoreGoldenFacts('Steve i Alex mają ramiona o tej samej szerokości.', {
    independentGold: true,
    mustInclude: [['Steve']],
    mustNot: ['Steve i Alex mają ramiona o tej samej szerokości'],
  });
  assert.equal(result.passed, false);
  assert.equal(result.score, 0.5);
  assert.deepEqual(result.forbidden, ['Steve i Alex mają ramiona o tej samej szerokości']);
});

test('benchmark detects common refusal variants as abstentions', () => {
  for (const refusal of [
    'Nie mam wystarczających danych, aby odpowiedzieć na to pewnie.',
    'Nie mogę potwierdzić tej informacji, więc nie będę zgadywać.',
    '@benchmark Chwilowo nie mogę potwierdzić tej informacji, więc nie będę zgadywać.',
    "I don't have enough information to answer confidently.",
    "I can't confirm this information, so I won't guess.",
    'Insufficient information.',
  ]) {
    assert.equal(isFailureText(refusal), true, refusal);
  }
});

test('a canned refusal is reported as abstention, not a complete where answer', () => {
  const item = {
    game: 'Elden Ring',
    question: 'Gdzie znaleźć Wielki Miecz?',
    routing: { intent: 'web_fact', is_lore: false, is_gameplay: false },
  };
  const result = evaluateBenchmarkAnswer('@benchmark Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.', item);
  assert.equal(result.answered, false);
  assert.equal(result.abstained, true);
  assert.equal(result.completeness, 0);
  assert.equal(result.judgeStatus, 'abstained');
  assert.deepEqual(result.missing, ['entity_context', 'where']);
  assert.equal(isFailureText('Wielki Miecz leży na zachód od Caelid.'), false);
});

test('Dragonrend gold facts match ordinary Polish inflections in the benchmark fixture', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-benchmark.json'), 'utf8'));
  const item = benchmark.cases.find(testCase => testCase.id === 'how-057');
  assert.ok(item, 'expected Skyrim Dragonrend gold case');
  const answer = 'W Skyrim użyj Krzyku Dragonrend, aby zmusić smoka do lądowania, a potem atakuj go bronią białą lub łukiem.';
  assert.equal(scoreGoldenFacts(answer, item.expected.factual).passed, true);
});

test('live benchmark always samples an independent gold case, even with a nonzero seed', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-benchmark.json'), 'utf8'));
  for (const seed of [0, 1, 113, 499]) {
    const selected = stratifiedCases(benchmark.cases, 5, seed);
    assert.equal(selected.length, 5);
    assert.ok(
      selected.some(item => item.expected?.factual?.independentGold === true),
      `seed ${seed} did not include an independent gold case`,
    );
  }
});

test('live diagnostics distinguish validator failures from generation failures and report gold coverage', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-benchmark.json'), 'utf8'));
  const selected = stratifiedCases(benchmark.cases, 5, 113);
  const diagnostics = buildBenchmarkDiagnostics([{
    finalStatus: 'rejected',
    modelCalls: 3,
    generationAttempts: [{ provider: 'gemini', model: 'gemini-3.8-flash', status: 'error', failure: 'timeout' }],
    validatorResults: [
      { provider: 'gemini', model: 'gemini-3.8-flash', status: 'rejected' },
      { provider: 'groq', model: 'openai/gpt-oss-20b', status: 'unavailable', technicalError: true, reason: 'timeout' },
    ],
    timingTrace: [{ stage: 'validator_second_opinion' }, { stage: 'tavily_http_end', durationMs: 1200, ok: true }, { stage: 'generation_cycle_start', elapsedMs: 24200 }],
  }], benchmark.cases, selected);

  assert.equal(diagnostics.validatorCalls, 2);
  assert.deepEqual(diagnostics.validatorProviderCalls, { gemini: 1, groq: 1 });
  assert.equal(diagnostics.validatorStatusCounts.rejected, 1);
  assert.equal(diagnostics.validatorStatusCounts.unavailable, 1);
  assert.equal(diagnostics.validatorTransportFailures.length, 1);
  assert.deepEqual(diagnostics.generationProviderFailures, ['gemini:gemini-3.8-flash:timeout']);
  assert.equal(diagnostics.validatorSecondOpinions, 1);
  assert.equal(diagnostics.tavilyHttpCalls, 1);
  assert.equal(diagnostics.avgTavilyHttpMs, 1200);
  assert.equal(diagnostics.avgElapsedToGenerationCycleMs, 24200);
  assert.equal(diagnostics.independentGoldCasesInSample.length, 1);
  assert.equal(diagnostics.goldCoverageByCategory.how.independentGold, 1);
});

test('live diagnostics report validator unavailability per call and detect outages of any provider', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-benchmark.json'), 'utf8'));
  const selected = stratifiedCases(benchmark.cases, 5, 113);
  // Gemini niedostępne w każdym wywołaniu: to awaria providera, a nie wynik kodu.
  const diagnostics = buildBenchmarkDiagnostics([{
    finalStatus: 'rejected',
    modelCalls: 3,
    generationAttempts: [{ provider: 'groq', model: 'openai/gpt-oss-120b', status: 'success' }],
    validatorResults: [
      { provider: 'gemini', model: 'gemini-3.5-flash-lite', status: 'unavailable', technicalError: true, reason: 'timeout' },
      { provider: 'gemini', model: 'gemini-3.5-flash-lite', status: 'unavailable', technicalError: true, reason: 'timeout' },
      { provider: 'groq', model: 'openai/gpt-oss-20b', status: 'rejected' },
    ],
    timingTrace: [],
  }], benchmark.cases, selected);

  // Licznik dotyczy WYWOŁAŃ walidatora, nie końca requestu.
  assert.equal(diagnostics.validatorUnavailable, 2);
  assert.equal(diagnostics.requestsUnavailable, 0);
  // Awaria Gemini w każdym wywołaniu musi być widoczna, inaczej benchmark
  // raportuje providerOutage=false i uznaje pomiar za ważny.
  assert.equal(diagnostics.providerOutage, true);
  assert.deepEqual(diagnostics.outageProviders, ['gemini']);
  // Provider, który odpowiedział, nie jest awarią.
  assert.equal(diagnostics.outageProviders.includes('groq'), false);
});

test('live diagnostics detect generation-only provider outages', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-benchmark.json'), 'utf8'));
  const selected = stratifiedCases(benchmark.cases, 5, 113);
  const diagnostics = buildBenchmarkDiagnostics([{
    finalStatus: 'unavailable',
    modelCalls: 0,
    generationAttempts: [
      { provider: 'groq', model: 'openai/gpt-oss-120b', status: 'error', failure: 'timeout' },
      { provider: 'groq', model: 'openai/gpt-oss-20b', status: 'error', failure: 'timeout' },
    ],
    validatorResults: [],
    timingTrace: [],
  }], benchmark.cases, selected);
  assert.equal(diagnostics.providerOutage, true);
  assert.deepEqual(diagnostics.outageProviders, ['groq']);
});

test('live diagnostics separate provider quota, timeout, budget and evidence rejection', () => {
  assert.equal(classifyBenchmarkOutcome({ judgeStatus: 'accepted', factualPassed: true }), 'accepted');
  assert.equal(classifyBenchmarkOutcome({ finalStatus: 'unavailable', fallbackReasons: ['quota'] }), 'provider_quota');
  assert.equal(classifyBenchmarkOutcome({ finalStatus: 'unavailable', generationAttempts: [{ failure: 'timeout' }] }), 'provider_timeout');
  assert.equal(classifyBenchmarkOutcome({ finalStatus: 'rejected', fallbackReasons: ['budget_exhausted'] }), 'no_fallback_budget');
  assert.equal(classifyBenchmarkOutcome({ finalStatus: 'rejected', rejectionReason: 'evidence_quote nie istnieje w źródle' }), 'evidence_rejection');
  const diagnostics = buildBenchmarkDiagnostics([
    { judgeStatus: 'accepted', factualPassed: true },
    { finalStatus: 'unavailable', fallbackReasons: ['quota'] },
    { finalStatus: 'unavailable', generationAttempts: [{ failure: 'timeout' }] },
    { finalStatus: 'rejected', fallbackReasons: ['budget_exhausted'] },
  ], [], []);
  assert.deepEqual(diagnostics.outcomeCounts, {
    accepted: 1,
    provider_quota: 1,
    provider_timeout: 1,
    no_fallback_budget: 1,
  });
});

test('benchmark classifies provider HTTP status and pipeline errors separately', () => {
  assert.equal(classifyBenchmarkOutcome({
    finalStatus: 'unavailable',
    generationAttempts: [{ statusCode: 429, message: 'provider error' }],
  }), 'provider_quota');
  assert.equal(classifyBenchmarkOutcome({
    judgeStatus: 'error',
    finalStatus: 'error',
    rejectionReason: 'unexpected TypeError',
  }), 'pipeline_error');
  assert.equal(classifyBenchmarkOutcome({
    judgeStatus: 'abstained',
    finalStatus: 'rejected',
  }), 'abstention');
  assert.equal(classifyBenchmarkOutcome({
    judgeStatus: 'error',
    validatorResults: [{ status: 'unavailable', reason: 'timeout' }],
  }), 'provider_timeout');
});

test('benchmark report is written atomically as valid JSON at the configured path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'czituch-benchmark-'));
  const outputPath = path.join(directory, 'nested', 'report.json');
  const report = { total: 1, failures: [{ id: 'where-169', judgeStatus: 'abstained' }] };
  try {
    const serialized = writeBenchmarkReport(report, outputPath);
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), report);
    assert.equal(serialized, fs.readFileSync(outputPath, 'utf8'));
    assert.equal(fs.readdirSync(path.dirname(outputPath)).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('benchmark stdout writer waits until the stream flushes', async () => {
  let completed = false;
  let written = '';
  const stream = {
    write(text, callback) {
      written = text;
      setTimeout(() => {
        completed = true;
        callback();
      }, 5);
      return true;
    },
  };
  await writeStdoutAndWait('{"ok":true}\n', stream);
  assert.equal(completed, true);
  assert.equal(written, '{"ok":true}\n');
});

test('odrzucona odpowiedź pochodzi z ostatniego werdyktu walidatora, nie z pierwszego', () => {
  // Bot (czituch_bot.js) bierze ostatni wynik walidatora — cykl naprawczy może
  // przepisać odpowiedź, a to, co pipeline wyrzucił, pochodzi z ostatniego
  // werdyktu. Benchmark musi liczyć fałszywe odrzucenia na tym samym tekście.
  const summary = {
    validatorResults: [
      { validationDiagnostics: { benchmarkTrace: { answer: 'pierwsza wersja odpowiedzi' } } },
      { validationDiagnostics: { benchmarkTrace: { answer: 'ostateczna wersja odpowiedzi' } } },
    ],
  };
  assert.equal(wybierzOdrzuconaOdpowiedz(summary, false), 'ostateczna wersja odpowiedzi');
  // Odpowiedź, która została wydana, nie ma treści odrzuconej.
  assert.equal(wybierzOdrzuconaOdpowiedz(summary, true), null);
  // Brak śladu walidatora → brak odrzuconej treści.
  assert.equal(wybierzOdrzuconaOdpowiedz({}, false), null);
  // Pusta treść w ostatnim wyniku nie może zasłonić wcześniejszego.
  const zPustym = {
    validatorResults: [
      { validationDiagnostics: { benchmarkTrace: { answer: 'wczesniejsza odpowiedź' } } },
      { validationDiagnostics: { benchmarkTrace: { answer: '   ' } } },
    ],
  };
  assert.equal(wybierzOdrzuconaOdpowiedz(zPustym, false), 'wczesniejsza odpowiedź');
});
