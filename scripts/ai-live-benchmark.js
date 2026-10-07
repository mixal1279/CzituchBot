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

const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-benchmark.json'), 'utf8'));
const limit = Math.max(1, Math.min(benchmark.cases.length, Number(process.env.AI_BENCHMARK_LIMIT) || benchmark.cases.length));
const delayMs = Math.max(0, Number(process.env.AI_BENCHMARK_DELAY_MS) || 0);
const cases = benchmark.cases.slice(0, limit);

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
        },
      );

      const plan = buildAnswerPlan(item.question, { ...item.routing, game: item.game });
      const judge = judgeAnswer(answer, plan);
      results.push({
        id: item.id,
        category: item.category,
        answered: Boolean(answer.trim()) && !isFailureText(answer),
        completeness: judge.score,
        judgeStatus: judge.status,
        missing: judge.missing,
      });
    } catch (error) {
      results.push({
        id: item.id,
        category: item.category,
        answered: false,
        completeness: 0,
        judgeStatus: 'error',
        missing: [],
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
  const report = {
    benchmark: benchmark.name,
    mode: 'live',
    total: results.length,
    answeredAccuracy: Number((answered / results.length).toFixed(4)),
    completenessAccuracy: Number((complete / results.length).toFixed(4)),
    durationMs: Date.now() - started,
    note: 'Ten testuje produkcyjny pipeline i kompletność odpowiedzi. Nie jest niezależnym pomiarem factual accuracy; do tego potrzebny jest ręcznie zweryfikowany gold answer/fact set.',
    failures: results.filter(x => !x.answered || x.judgeStatus !== 'accepted').slice(0, 100),
  };
  console.log(JSON.stringify(report, null, 2));
}

run().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
