'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeFactText, scoreGoldenFacts } = require('../ai/benchmark-scorer');
const { buildQuestionForBot, evaluateBenchmarkAnswer, isFailureText, writeBenchmarkReport } = require('../scripts/ai-live-benchmark');

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
