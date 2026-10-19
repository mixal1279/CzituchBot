'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeFactText, scoreGoldenFacts } = require('../ai/benchmark-scorer');
const { buildQuestionForBot, evaluateBenchmarkAnswer, buildBenchmarkDiagnostics, stratifiedCases, isFailureText, writeBenchmarkReport, writeStdoutAndWait } = require('../scripts/ai-live-benchmark');

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

test('forbidden golden fact is detected after Polish normalization', () => {
  const result = scoreGoldenFacts('Wheatley przejął kontrolę, a GLaDOS nie została wyłączona.', {
    independentGold: true,
    mustInclude: [['Wheatley']],
    mustNot: ['GLaDOS nie została wyłączona'],
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.forbidden, ['GLaDOS nie została wyłączona']);
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
    timingTrace: [{ stage: 'validator_second_opinion' }],
  }], benchmark.cases, selected);

  assert.equal(diagnostics.validatorCalls, 2);
  assert.deepEqual(diagnostics.validatorProviderCalls, { gemini: 1, groq: 1 });
  assert.equal(diagnostics.validatorStatusCounts.rejected, 1);
  assert.equal(diagnostics.validatorStatusCounts.unavailable, 1);
  assert.equal(diagnostics.validatorTransportFailures.length, 1);
  assert.deepEqual(diagnostics.generationProviderFailures, ['gemini:gemini-3.8-flash:timeout']);
  assert.equal(diagnostics.validatorSecondOpinions, 1);
  assert.equal(diagnostics.independentGoldCasesInSample.length, 1);
  assert.equal(diagnostics.goldCoverageByCategory.how.independentGold, 0);
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
