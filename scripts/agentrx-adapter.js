'use strict';

// Converts the existing benchmark report into a compact AgentRx trajectory.
// The benchmark stores provider attempts, timing events, and validator results
// separately; this adapter preserves each source's order but does NOT claim
// to reconstruct exact cross-array wall-clock ordering.
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2] || 'benchmark-artifact/ai-live-benchmark.json';
const output = process.argv[3] || 'agentrx-trajectory.json';
const report = JSON.parse(fs.readFileSync(input, 'utf8'));

if (!report || typeof report !== 'object' || !Array.isArray(report.failures)) {
  throw new Error('Invalid benchmark report: expected a JSON object with failures[]');
}

const allResults = Array.isArray(report.results) ? report.results : report.failures;
const selected = allResults.filter(item =>
  item && (item.judgeStatus !== 'accepted' || item.factualPassed === false || item.falseReject === true)
);

const trajectories = selected.map(item => {
  const steps = [];
  steps.push({
    step_id: 'benchmark_case',
    type: 'observation',
    description: 'Benchmark case outcome and scoring',
    data: {
      case_id: item.id ?? null,
      category: item.category ?? null,
      judge_status: item.judgeStatus ?? null,
      final_status: item.finalStatus ?? null,
      factual_passed: item.factualPassed ?? null,
      false_reject: item.falseReject ?? false,
      rejection_reason: item.rejectionReason ?? null,
      missing: item.missing ?? [],
      factual_missing: item.factualMissing ?? [],
      factual_forbidden: item.factualForbidden ?? []
    }
  });

  for (const [index, attempt] of (item.generationAttempts || []).entries()) {
    steps.push({
      step_id: `generation_attempt_${index + 1}`,
      type: 'tool_call',
      description: 'Recorded model-provider generation attempt; order is provider-array order, not guaranteed global chronology',
      data: attempt
    });
  }

  for (const [index, event] of (item.timingTrace || []).entries()) {
    steps.push({
      step_id: `timing_event_${index + 1}`,
      type: 'observation',
      description: 'Recorded pipeline timing event',
      data: event
    });
  }

  for (const [index, validator] of (item.validatorResults || []).entries()) {
    steps.push({
      step_id: `validator_result_${index + 1}`,
      type: 'tool_result',
      description: 'Recorded validator result; order is validator-array order, not guaranteed global chronology',
      data: validator
    });
  }

  steps.push({
    step_id: 'final_evaluation',
    type: 'observation',
    description: 'Final benchmark evaluation',
    data: {
      answered: item.answered ?? null,
      judge_status: item.judgeStatus ?? null,
      final_status: item.finalStatus ?? null,
      factual_score: item.factualScore ?? null,
      factual_passed: item.factualPassed ?? null,
      false_reject: item.falseReject ?? false,
      model_calls: item.modelCalls ?? null,
      generation_budget: item.generationBudget ?? null,
      fallback_reasons: item.fallbackReasons ?? []
    }
  });

  return {
    trajectory_id: String(item.id ?? 'unknown-case'),
    task: 'Diagnose this failed CzituchBot AI Live Benchmark case. Distinguish code defects from provider outages, quotas, and incomplete telemetry.',
    metadata: {
      benchmark: report.benchmark ?? null,
      seed: report.seed ?? null,
      total_cases: report.total ?? null,
      source_commit: process.env.GITHUB_SHA ?? null,
      synthesized_from_benchmark_record: true,
      chronology_warning: 'Arrays are individually ordered, but the report does not guarantee exact cross-array event chronology.'
    },
    steps
  };
});

if (!trajectories.length) {
  throw new Error('No failed cases found for AgentRx analysis; report may be incomplete or all cases passed.');
}

const payload = {
  source: 'CzituchBot AI Live Benchmark',
  benchmark: report.benchmark ?? null,
  seed: report.seed ?? null,
  valid: report.valid ?? null,
  total: report.total ?? null,
  summary: {
    failed_cases: trajectories.length,
    false_rejects: report.falseRejects ?? null,
    diagnostics: report.diagnostics ?? {}
  },
  trajectories
};

fs.writeFileSync(path.resolve(output), `${JSON.stringify(payload, null, 2)}\\n`, { mode: 0o600 });
console.log(`Prepared ${trajectories.length} benchmark case trajectory/trajectories at ${output}`);
