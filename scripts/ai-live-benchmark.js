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

async function run() {
  const { zapytajAI } = require('../czituch_bot');
  resetProviderQuotaCooldowns();
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
          maxCzasMs: 40000,
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
  console.log(JSON.stringify(report, null, 2));
  if (process.env.AI_BENCHMARK_REQUIRE_PERFECT === '1') {
    const factualOk = factualCases.length > 0 && factualPassed === factualCases.length;
    if (answered !== results.length || complete !== results.length || !factualOk) {
      console.error(`[LIVE BENCHMARK] wymagane 10/10; odpowiedzi=${answered}/${results.length}, kompletność=${complete}/${results.length}, factual=${factualPassed}/${factualCases.length}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { normalizeFactText, scoreGoldenFacts, stratifiedCases, run };

if (require.main === module) {
  run().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
