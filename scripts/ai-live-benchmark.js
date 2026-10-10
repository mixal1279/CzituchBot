'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildAnswerPlan } = require('../ai/answer-plan');
const { judgeAnswer } = require('../ai/answer-judge');
const { zapytajAI } = require('../czituch_bot');

if (process.env.AI_LIVE_BENCHMARK !== '1') {
  console.error('Live benchmark jest celowo zablokowany. Ustaw AI_LIVE_BENCHMARK=1.');
  process.exit(2);
}

const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'ai-benchmark.json'), 'utf8'));
const defaultLimit = Math.min(10, benchmark.cases.length);
const requestedLimit = Number(process.env.AI_BENCHMARK_LIMIT);
const limit = Math.max(1, Math.min(benchmark.cases.length, Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit));
const delayMs = Math.max(0, Number(process.env.AI_BENCHMARK_DELAY_MS) || 0);
function stratifiedCases(all, requested) {
  if (requested >= all.length) return [...all];
  const groups = new Map();
  for (const item of all) {
    const key = item.category || 'uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...groups.keys()];
  const selected = [];
  let cursor = 0;
  while (selected.length < requested && keys.length) {
    const key = keys[cursor % keys.length];
    const bucket = groups.get(key);
    if (bucket.length) selected.push(bucket.shift());
    if (!bucket.length) keys.splice(cursor % keys.length, 1);
    else cursor++;
  }
  return selected;
}
const cases = stratifiedCases(benchmark.cases, limit);

function normalizeFactText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function scoreGoldenFacts(answer, factual) {
  if (!factual?.independentGold) return { applicable: false, score: null, passed: null, missing: [], forbidden: [] };
  const text = normalizeFactText(answer);
  const missing = [];
  for (const group of factual.mustInclude || []) {
    const ok = group.every(phrase => normalizeFactText(phrase).split(' ').every(token => text.includes(token)));
    if (!ok) missing.push(group);
  }
  const forbidden = (factual.mustNot || []).filter(phrase => text.includes(normalizeFactText(phrase)));
  const total = (factual.mustInclude || []).length;
  const score = total ? (total - missing.length) / total : 1;
  return { applicable: true, score, passed: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

function isFailureText(text) {
  return /nie mam wystarczających danych|nie mogę wiarygodnie potwierdzić|nie mogę potwierdzić tej informacji|nie będę zgadywać/i.test(String(text || ''));
}

async function sleep(ms) {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const started = Date.now();
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i];
    let answer = '';
    let summary = null;
    try {
      await zapytajAI(
        'benchmark',
        item.question,
        [],
        'Odpowiadaj rzeczowo po polsku. Korzystaj wyłącznie z potwierdzonych danych referencyjnych i nie zgaduj.',
        async text => { answer = String(text || ''); },
        {
          aiProfile: 'generic',
          memoryUserId: 'ai-benchmark',
          temperature: 0.2,
          max_tokens: 300,
          __testDeps: {
            onSummary: value => { summary = value; },
          },
        },
      );

      const plan = buildAnswerPlan(item.question, { ...item.routing, game: item.game });
      const judge = judgeAnswer(answer, plan);
      const factual = scoreGoldenFacts(answer, item.expected?.factual);
      results.push({
        id: item.id,
        category: item.category,
        summaryPresent: Boolean(summary),
        answered: Boolean(answer.trim()) && !isFailureText(answer),
        completeness: judge.score,
        judgeStatus: judge.status,
        missing: judge.missing,
        factualScore: factual.score,
        factualPassed: factual.passed,
        factualMissing: factual.missing,
        factualForbidden: factual.forbidden,
        finalStatus: summary?.finalStatus || null,
        modelCalls: summary?.modelCalls ?? null,
        generationAttempts: summary?.generationAttempts || [],
        generationBudget: summary?.generationBudget || null,
        validatorResults: summary?.validatorResults || [],
        fallbackReasons: summary?.fallbackReasons || [],
        tavilySearches: summary?.tavilySearches ?? null,
        sourceCount: summary?.sourceCount ?? null,
      });
    } catch (error) {
      results.push({
        id: item.id,
        category: item.category,
        summaryPresent: Boolean(summary),
        answered: false,
        completeness: 0,
        judgeStatus: 'error',
        missing: [],
        factualScore: item.expected?.factual?.independentGold ? 0 : null,
        factualPassed: item.expected?.factual?.independentGold ? false : null,
        factualMissing: [],
        factualForbidden: [],
        finalStatus: summary?.finalStatus || 'error',
        modelCalls: summary?.modelCalls ?? null,
        generationAttempts: summary?.generationAttempts || [],
        generationBudget: summary?.generationBudget || null,
        validatorResults: summary?.validatorResults || [],
        fallbackReasons: summary?.fallbackReasons || [],
        tavilySearches: summary?.tavilySearches ?? null,
        sourceCount: summary?.sourceCount ?? null,
        error: String(error?.message || error),
      });
    }

    if ((i + 1) % 10 === 0 || i + 1 === cases.length) {
      const answered = results.filter(x => x.answered).length / results.length;
      const complete = results.filter(x => x.judgeStatus === 'accepted').length / results.length;
      console.log(`[LIVE BENCHMARK] ${i + 1}/${cases.length} answered=${(answered * 100).toFixed(1)}% complete=${(complete * 100).toFixed(1)}%`);
    }
    await sleep(delayMs);
  }

  const answered = results.filter(x => x.answered).length;
  const complete = results.filter(x => x.judgeStatus === 'accepted').length;
  const factualCases = results.filter(x => x.factualPassed !== null);
  const factualPassed = factualCases.filter(x => x.factualPassed).length;
  const factualAverage = factualCases.length ? factualCases.reduce((sum, x) => sum + x.factualScore, 0) / factualCases.length : null;
  const diagnostic = {
    validatorAccepted: results.filter(x => x.finalStatus === 'accepted').length,
    validatorSoftAccepted: results.filter(x => x.finalStatus === 'soft_accepted').length,
    validatorRejected: results.filter(x => x.finalStatus === 'rejected').length,
    validatorInconclusive: results.filter(x => x.finalStatus === 'inconclusive').length,
    validatorUnavailable: results.filter(x => x.finalStatus === 'unavailable').length,
    repairUsed: results.filter(x => Number(x.generationBudget?.repairUsed || 0) > 0).length,
    repairSkipped: results.filter(x => Number(x.generationBudget?.repairUsed || 0) === 0 && x.finalStatus === 'rejected').length,
    acceptedButIncomplete: results.filter(x => ['accepted', 'soft_accepted'].includes(x.finalStatus) && x.judgeStatus !== 'accepted').map(x => ({ id: x.id, finalStatus: x.finalStatus, judgeStatus: x.judgeStatus, missing: x.missing })),
    missingSummaryCases: results.filter(x => !x.summaryPresent).map(x => x.id),
    missingFinalStatusCases: results.filter(x => !x.finalStatus).map(x => x.id),
    missingModelCallTelemetryCases: results.filter(x => !Number.isFinite(x.modelCalls)).map(x => x.id),
    generationAttemptsMissing: results.filter(x => !Array.isArray(x.generationAttempts)).map(x => x.id),
    telemetryCoverage: Number((results.filter(x => x.summaryPresent && Boolean(x.finalStatus) && Number.isFinite(x.modelCalls)).length / results.length).toFixed(4)),
    avgModelCalls: results.filter(x => Number.isFinite(x.modelCalls)).length
      ? Number((results.filter(x => Number.isFinite(x.modelCalls)).reduce((sum, x) => sum + x.modelCalls, 0) / results.filter(x => Number.isFinite(x.modelCalls)).length).toFixed(2))
      : null,
    providerFailures: [...new Set(results.flatMap(x => (x.generationAttempts || []).filter(a => a.status === 'error').map(a => `${a.provider}:${a.model}:${a.failure || 'unknown'}`)))],
  };
  const report = {
    benchmark: benchmark.name,
    mode: 'live',
    total: results.length,
    answeredAccuracy: Number((answered / results.length).toFixed(4)),
    completenessAccuracy: Number((complete / results.length).toFixed(4)),
    factualGoldCases: factualCases.length,
    factualAccuracy: factualCases.length ? Number((factualPassed / factualCases.length).toFixed(4)) : null,
    factualAverageScore: factualAverage === null ? null : Number(factualAverage.toFixed(4)),
    durationMs: Date.now() - started,
    note: 'Ten testuje produkcyjny pipeline i kompletność odpowiedzi. Nie jest niezależnym pomiarem factual accuracy; do tego potrzebny jest ręcznie zweryfikowany gold answer/fact set.',
    categories: [...new Set(results.map(x => x.category))].sort(),
    diagnostics: diagnostic,
    failures: results.filter(x => !x.answered || x.judgeStatus !== 'accepted' || x.factualPassed === false).slice(0, 100),
  };
  console.log('\n=== LIVE BENCHMARK SUMMARY ===');
  console.log(`Cases: ${report.total}`);
  console.log(`Answered: ${answered}/${results.length} (${(report.answeredAccuracy * 100).toFixed(1)}%)`);
  console.log(`Complete: ${complete}/${results.length} (${(report.completenessAccuracy * 100).toFixed(1)}%)`);
  console.log(`Factual gold: ${factualCases.length ? `${factualPassed}/${factualCases.length} (${(report.factualAccuracy * 100).toFixed(1)}%)` : 'not measured'}`);
  console.log(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  console.log(`Validator: accepted=${diagnostic.validatorAccepted}, soft_accepted=${diagnostic.validatorSoftAccepted}, rejected=${diagnostic.validatorRejected}, inconclusive=${diagnostic.validatorInconclusive}, unavailable=${diagnostic.validatorUnavailable}`);
  console.log(`Telemetry coverage: ${(diagnostic.telemetryCoverage * 100).toFixed(1)}%`);
  if (diagnostic.missingSummaryCases.length) console.log(`Missing summaries: ${diagnostic.missingSummaryCases.join(', ')}`);
  if (diagnostic.missingFinalStatusCases.length) console.log(`Missing final status: ${diagnostic.missingFinalStatusCases.join(', ')}`);
  if (diagnostic.missingModelCallTelemetryCases.length) console.log(`Missing model-call telemetry: ${diagnostic.missingModelCallTelemetryCases.join(', ')}`);
  if (diagnostic.providerFailures.length) console.log(`Provider failures: ${diagnostic.providerFailures.join(' | ')}`);
  console.log('=== FULL JSON REPORT (logs) ===');
  console.log(JSON.stringify(report, null, 2));
}

run().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
