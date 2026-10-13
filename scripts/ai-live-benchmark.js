'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildAnswerPlan } = require('../ai/answer-plan');
const { judgeAnswer } = require('../ai/answer-judge');
const { normalizeFactText, scoreGoldenFacts } = require('../ai/benchmark-scorer');
const { resetProviderQuotaCooldowns } = require('../ai/fallback');

if (require.main === module && process.env.AI_LIVE_BENCHMARK !== '1') {
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

function isFailureText(text) {
  return /nie mam wystarczających danych|nie mogę wiarygodnie potwierdzić|nie mogę potwierdzić tej informacji|nie będę zgadywać/i.test(String(text || ''));
}

async function sleep(ms) {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

function aggregateValidatorMetrics(metrics = []) {
  const byValidator = {};
  for (const metric of metrics) {
    const key = metric.validator || 'unknown';
    const row = byValidator[key] ||= {
      attempted: 0, skippedBudget: 0, skippedSlot: 0, avgMs: null,
      timeouts: 0, httpErrors: 0, emptyResponses: 0, invalidJson: 0,
      unavailable: 0, accepted: 0, softAccepted: 0, rejected: 0,
    };
    if (metric.outcome === 'attempted') row.attempted++;
    if (metric.outcome === 'skipped_budget') row.skippedBudget++;
    if (metric.outcome === 'skipped_slot') row.skippedSlot++;
    if (metric.failureReason === 'timeout') row.timeouts++;
    if (metric.failureReason === 'http_error') row.httpErrors++;
    if (metric.failureReason === 'empty_response') row.emptyResponses++;
    if (metric.failureReason === 'invalid_json') row.invalidJson++;
    if (metric.status === 'unavailable') row.unavailable++;
    if (metric.status === 'accepted') row.accepted++;
    if (metric.status === 'soft_accepted') row.softAccepted++;
    if (metric.status === 'rejected') row.rejected++;
    if (Number.isFinite(metric.actualMs) && metric.outcome === 'attempted') {
      row._totalMs = (row._totalMs || 0) + metric.actualMs;
      row._timedCalls = (row._timedCalls || 0) + 1;
    }
  }
  for (const row of Object.values(byValidator)) {
    row.avgMs = row._timedCalls ? Math.round(row._totalMs / row._timedCalls) : null;
    delete row._totalMs;
    delete row._timedCalls;
  }
  return byValidator;
}

async function runOnce(runNumber = 1) {
  const { zapytajAI, resetGeminiValidatorCooldownForBenchmark } = require('../czituch_bot');
  resetProviderQuotaCooldowns();
  resetGeminiValidatorCooldownForBenchmark();
  const started = Date.now();
  const results = [];
  const validatorMetricsRaw = [];
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
        answer,
        answered: Boolean(answer.trim()) && !isFailureText(answer),
        completeness: judge.score,
        judgeStatus: judge.status,
        rejectionReason: [
          judge.status !== 'accepted' ? judge.reason : null,
          ...(summary?.validatorResults || [])
            .filter(result => result.status === 'rejected')
            .map(result => [result.reason, ...(result.validationDiagnostics?.localRejectReasons || [])].filter(Boolean).join(': ')),
          ...(summary?.fallbackReasons || []),
        ].filter(Boolean).join(' | ') || null,
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
        validatorMetrics: summary?.validatorMetrics || {},
        validatorMetricsRaw: summary?.validatorMetricsRaw || [],
        fallbackReasons: summary?.fallbackReasons || [],
        tavilySearches: summary?.tavilySearches ?? null,
        sourceCount: summary?.sourceCount ?? null,
      });
    } catch (error) {
      results.push({
        id: item.id,
        category: item.category,
        answer,
        answered: false,
        completeness: 0,
        judgeStatus: 'error',
        rejectionReason: String(error?.message || error),
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
        validatorMetrics: summary?.validatorMetrics || {},
        fallbackReasons: summary?.fallbackReasons || [],
        tavilySearches: summary?.tavilySearches ?? null,
        sourceCount: summary?.sourceCount ?? null,
        error: String(error?.message || error),
      });
    }

    validatorMetricsRaw.push(...(summary?.validatorMetricsRaw || []));

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
    validatorRejected: results.filter(x => x.finalStatus === 'rejected').length,
    validatorInconclusive: results.filter(x => x.finalStatus === 'inconclusive').length,
    validatorUnavailable: results.filter(x => x.finalStatus === 'unavailable').length,
    repairUsed: results.filter(x => Number(x.generationBudget?.repairUsed || 0) > 0).length,
    repairSkipped: results.filter(x => Number(x.generationBudget?.repairUsed || 0) === 0 && x.finalStatus === 'rejected').length,
    avgModelCalls: results.filter(x => Number.isFinite(x.modelCalls)).length
      ? Number((results.filter(x => Number.isFinite(x.modelCalls)).reduce((sum, x) => sum + x.modelCalls, 0) / results.filter(x => Number.isFinite(x.modelCalls)).length).toFixed(2))
      : null,
    providerFailures: [...new Set(results.flatMap(x => (x.generationAttempts || []).filter(a => a.status === 'error').map(a => `${a.provider}:${a.model}:${a.failure || 'unknown'}`)))],
  };
  const report = {
    benchmark: benchmark.name,
    mode: 'live',
    run: runNumber,
    total: results.length,
    answeredAccuracy: Number((answered / results.length).toFixed(4)),
    completenessAccuracy: Number((complete / results.length).toFixed(4)),
    factualGoldCases: factualCases.length,
    factualAccuracy: factualCases.length ? Number((factualPassed / factualCases.length).toFixed(4)) : null,
    factualAverageScore: factualAverage === null ? null : Number(factualAverage.toFixed(4)),
    durationMs: Date.now() - started,
    note: 'Ten testuje produkcyjny pipeline i kompletność odpowiedzi. Nie jest niezależnym pomiarem factual accuracy; do tego potrzebny jest ręcznie zweryfikowany gold answer/fact set.',
    categories: [...new Set(results.map(x => x.category))].sort(),
    validatorMetrics: aggregateValidatorMetrics(validatorMetricsRaw),
    validatorMetricsRaw,
    diagnostics: diagnostic,
    results,
    failures: results.filter(x => !x.answered || x.judgeStatus !== 'accepted' || x.factualPassed === false).slice(0, 100),
  };
  const outputDir = process.env.AI_BENCHMARK_OUTPUT_DIR || path.join(process.cwd(), 'benchmark-results');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `run-${runNumber}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('\n=== VALIDATOR_METRICS_RAW ===');
  console.log(JSON.stringify(validatorMetricsRaw, null, 2));
  if (process.env.AI_BENCHMARK_REQUIRE_PERFECT === '1') {
    const factualOk = factualCases.length > 0 && factualPassed === factualCases.length;
    if (answered !== results.length || complete !== results.length || !factualOk) {
      console.error(`[LIVE BENCHMARK] wymagane 10/10; odpowiedzi=${answered}/${results.length}, kompletność=${complete}/${results.length}, factual=${factualPassed}/${factualCases.length}`);
      process.exitCode = 1;
    }
  }
  return report;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

async function run() {
  const requestedRepeat = Number(process.env.AI_BENCHMARK_REPEAT);
  const repeat = Math.max(1, Math.min(20, Number.isFinite(requestedRepeat) && requestedRepeat > 0 ? Math.floor(requestedRepeat) : 1));
  const outputDir = process.env.AI_BENCHMARK_OUTPUT_DIR || path.join(process.cwd(), 'benchmark-results');
  fs.mkdirSync(outputDir, { recursive: true });
  const reports = [];
  for (let runNumber = 1; runNumber <= repeat; runNumber++) {
    console.log(`\\n[LIVE BENCHMARK] repeat ${runNumber}/${repeat}`);
    reports.push(await runOnce(runNumber));
  }
  const perRun = reports.map(report => ({
    run: report.run,
    answered: report.answeredAccuracy,
    completeness: report.completenessAccuracy,
    factualAccuracy: report.factualAccuracy,
    factualAverageScore: report.factualAverageScore,
    validatorMetrics: report.validatorMetrics,
    diagnostics: report.diagnostics,
    durationMs: report.durationMs,
  }));
  const ids = [...new Set(reports.flatMap(report => (report.results || []).map(result => result.id)))];
  const perQuestion = ids.map(id => {
    const runs = reports.map(report => {
      const result = (report.results || []).find(item => item.id === id);
      return result ? {
        run: report.run,
        answered: result.answered,
        completeness: result.completeness,
        judgeStatus: result.judgeStatus,
        factualScore: result.factualScore,
        factualPassed: result.factualPassed,
        finalStatus: result.finalStatus,
        validatorMetrics: result.validatorMetricsRaw || [],
      } : { run: report.run, missing: true };
    });
    const completeness = runs.map(item => item.completeness).filter(Number.isFinite);
    const factualScores = runs.map(item => item.factualScore).filter(Number.isFinite);
    return {
      id,
      runs,
      medianCompleteness: median(completeness),
      rangeCompleteness: completeness.length ? Math.max(...completeness) - Math.min(...completeness) : null,
      medianFactualScore: median(factualScores),
      rangeFactualScore: factualScores.length ? Math.max(...factualScores) - Math.min(...factualScores) : null,
    };
  });
  const answeredRates = perRun.map(item => item.answered);
  const completenessRates = perRun.map(item => item.completeness);
  const summary = {
    benchmark: benchmark.name,
    mode: 'live-repeated',
    repeat,
    totalCasesPerRun: cases.length,
    uniqueQuestions: ids.length,
    note: 'Repeated measures: run-level rates describe pipeline variability; perQuestion separates within-question variability from differences in question difficulty. factualAccuracy is raw against the current gold set, not a validated quality estimate.',
    perRun,
    perQuestion,
    global: {
      medianAnswered: median(answeredRates),
      iqrAnswered: answeredRates.length ? quantile(answeredRates, 0.75) - quantile(answeredRates, 0.25) : null,
      medianCompleteness: median(completenessRates),
      iqrCompleteness: completenessRates.length ? quantile(completenessRates, 0.75) - quantile(completenessRates, 0.25) : null,
    },
  };
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\\n=== REPEATED_BENCHMARK_SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = { normalizeFactText, scoreGoldenFacts, stratifiedCases, run, runOnce, median, quantile };

if (require.main === module) {
  run().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
