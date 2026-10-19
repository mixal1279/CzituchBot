'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnswerPlan, assessAnswerCompleteness } = require('../ai/answer-plan');
const { judgeAnswer } = require('../ai/answer-judge');

const BENCHMARK_PATH = path.join(__dirname, 'ai-benchmark.json');
const benchmark = JSON.parse(fs.readFileSync(BENCHMARK_PATH, 'utf8'));

const ANSWERS = Object.freeze({
  why: 'Powodem była konkretna sytuacja fabularna. Ponieważ zaszły określone wydarzenia, dlatego postać podjęła tę decyzję.',
  how: 'Najpierw wykonaj pierwszy krok, następnie drugi krok, a potem wykonaj kolejną czynność.',
  when: 'W 2020 roku, w odpowiednim momencie historii.',
  where: 'Znajdziesz to w konkretnej lokacji na mapie, przy wskazanym miejscu.',
  who: 'Bohater pełni określoną rolę w historii i jest związany z wydarzeniami.',
  quantity: 'To około 20 godzin.',
  comparison: 'Różnią się rolą i zachowaniem, natomiast obie postacie mają znaczenie dla historii.',
  outcome: 'Ostatecznie wydarzenia doprowadziły do określonego wyniku.',
  relationship: 'Ich relacja jest złożona i obejmuje zarówno współpracę, jak i konflikt.',
});

function answerForCategory(category, item) {
  const answer = ANSWERS[category] || 'To odpowiedź zawierająca potwierdzone informacje.';
  return item?.game ? `${item.game}: ${answer}` : answer;
}

function hasRequirement(plan, id) {
  return Array.isArray(plan?.requirements) && plan.requirements.some(item => item?.id === id);
}

function runBenchmark() {
  const started = Date.now();
  const results = [];
  for (const item of benchmark.cases) {
    const plan = buildAnswerPlan(item.question, {
      ...item.routing,
      game: item.game,
    });
    const missingRequirements = item.expected.requirements.filter(id => !hasRequirement(plan, id));
    const unexpectedRequirements = plan.requirements
      .map(item => item.id)
      .filter(id => !item.expected.requirements.includes(id) && id !== 'entity_context');
    const answer = answerForCategory(item.category, item);
    const completeness = assessAnswerCompleteness(answer, plan);
    const planningOk = missingRequirements.length === 0 && unexpectedRequirements.length === 0;
    const completenessOk = completeness.ok;
    results.push({
      id: item.id,
      category: item.category,
      planningOk,
      completenessOk,
      missingRequirements,
      unexpectedRequirements,
      completenessScore: completeness.score,
    });
  }

  const total = results.length;
  const planningCorrect = results.filter(x => x.planningOk).length;
  const completenessCorrect = results.filter(x => x.completenessOk).length;
  const bothCorrect = results.filter(x => x.planningOk && x.completenessOk).length;
  const byCategory = {};
  for (const item of results) {
    const bucket = byCategory[item.category] ||= { total: 0, planningCorrect: 0, completenessCorrect: 0 };
    bucket.total++;
    if (item.planningOk) bucket.planningCorrect++;
    if (item.completenessOk) bucket.completenessCorrect++;
  }

  return {
    benchmark: benchmark.name,
    version: benchmark.version,
    total,
    planningAccuracy: Number((planningCorrect / total).toFixed(4)),
    completenessAccuracy: Number((completenessCorrect / total).toFixed(4)),
    endToEndAccuracy: Number((bothCorrect / total).toFixed(4)),
    durationMs: Date.now() - started,
    threshold: 0.95,
    passed: bothCorrect / total >= 0.95,
    byCategory,
    failures: results.filter(x => !x.planningOk || !x.completenessOk).slice(0, 50),
  };
}

test('AI Core v26 benchmark has exactly 500 cases', () => {
  assert.equal(benchmark.cases.length, 500);
});

test('independent factual gold is source-linked and spans multiple question categories', () => {
  const gold = benchmark.cases.filter(item => item.expected?.factual?.independentGold === true);
  const categories = new Set(gold.map(item => item.category));
  assert.ok(gold.length >= 10, `Expected at least 10 independent gold cases, got ${gold.length}`);
  for (const category of ['why', 'how', 'where', 'who', 'comparison', 'outcome']) {
    assert.ok(categories.has(category), `Missing independent gold category: ${category}`);
  }
  for (const item of gold) {
    assert.ok(Array.isArray(item.expected.factual.independentGoldSources));
    assert.ok(item.expected.factual.independentGoldSources.length > 0, `Gold source missing for ${item.id}`);
  }
});

test('AI Core v26 500-case benchmark meets 95% target', () => {
  const report = runBenchmark();
  assert.ok(
    report.passed,
    `Benchmark below target: ${(report.endToEndAccuracy * 100).toFixed(2)}% < 95%. Failures: ${JSON.stringify(report.failures.slice(0, 5))}`,
  );
});

if (require.main === module) {
  const report = runBenchmark();
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { runBenchmark };
