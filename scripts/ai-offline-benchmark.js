'use strict';

// Benchmark offline: deterministyczna część pipeline'u na nagranych przypadkach, bez sieci i bez
// limitów API. Wynik nie zależy od Groqa/Gemini/Tavily, więc jest powtarzalny i można go uruchamiać
// w każdym PR. NIE mierzy jakości modelu (dowody i odpowiedzi są syntetyczne) — to robi live benchmark.
const fs = require('fs');
const path = require('path');

const policy = require('../ai/policy');
const router = require('../ai/router');
const planner = require('../ai/planner');
const { buildAnswerPlan } = require('../ai/answer-plan');
const { judgeAnswer } = require('../ai/answer-judge');
const { scoreGoldenFacts } = require('../ai/benchmark-scorer');
const { sprawdzTwardeFaktyOdpowiedzi, sprawdzFormatOdpowiedzi } = require('../ai/response');

const DEFAULT_FIXTURES = path.join(__dirname, '..', 'test', 'fixtures', 'ai-offline-cases.json');

function runCase(item) {
  const failures = [];
  const routing = router.classifyAIRequest(item.question, policy.okreslKategorieAI);
  const plan = planner.planAIRequest(item.question, routing);
  const expect = item.expect || {};
  if (expect.intent && routing.intent !== expect.intent) failures.push(`intent: oczekiwano ${expect.intent}, jest ${routing.intent}`);
  if (expect.notIntent && routing.intent === expect.notIntent) failures.push(`intent nie powinien być ${expect.notIntent}`);
  if (expect.profile && plan.responseProfile !== expect.profile) failures.push(`profil: oczekiwano ${expect.profile}, jest ${plan.responseProfile}`);

  const profile = planner.RESPONSE_PROFILES[plan.responseProfile] || {};
  const format = sprawdzFormatOdpowiedzi(item.answer, { maxZdania: profile.maxSentences, maxZnakow: 900 });
  if (!format.ok) failures.push(`format: ${format.reason}`);

  const hard = sprawdzTwardeFaktyOdpowiedzi(item.answer, item.evidence, item.question);
  if (!hard.ok) failures.push(`twarde fakty: ${hard.unsupported.join('; ')}`);

  const judge = judgeAnswer(item.answer, buildAnswerPlan(item.question, { ...routing, game: routing.game }));
  if (judge.status !== 'accepted') failures.push(`judge: ${judge.status} (brak: ${(judge.missing || []).join(', ')})`);

  if (item.gold) {
    const gold = scoreGoldenFacts(item.answer, { independentGold: true, ...item.gold });
    if (!gold.passed) failures.push(`gold: brakuje ${JSON.stringify(gold.missing || gold)}`);
  }
  return { id: item.id, ok: failures.length === 0, failures };
}

function runOfflineBenchmark(fixturePath = DEFAULT_FIXTURES) {
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const results = fixtures.cases.map(runCase);
  return { total: results.length, passed: results.filter(r => r.ok).length, results };
}

if (require.main === module) {
  const report = runOfflineBenchmark(process.argv[2] || DEFAULT_FIXTURES);
  for (const r of report.results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}${r.failures.length ? '\n     ' + r.failures.join('\n     ') : ''}`);
  console.log(`\nOFFLINE BENCHMARK: ${report.passed}/${report.total}`);
  process.exitCode = report.passed === report.total ? 0 : 1;
}

module.exports = { runOfflineBenchmark, runCase };
