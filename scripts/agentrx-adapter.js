'use strict';

// Convert each failed benchmark case into AgentRx's generic dialogue-style
// trajectory input. The benchmark keeps arrays of provider attempts, timing
// events, and validator results separately; the adapter therefore preserves
// their individual order but cannot reconstruct exact cross-array chronology.
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2] || 'benchmark-artifact/ai-live-benchmark.json';
const outputDir = process.argv[3] || 'agentrx-inputs';
const report = JSON.parse(fs.readFileSync(input, 'utf8'));

if (!report || typeof report !== 'object' || !Array.isArray(report.failures)) {
  throw new Error('Invalid benchmark report: expected a JSON object with failures[]');
}
if (report.failures.length === 0) {
  throw new Error('No failed cases in benchmark report; AgentRx diagnosis is unnecessary.');
}

fs.mkdirSync(outputDir, { recursive: true });
const written = [];

for (const item of report.failures) {
  if (!item || typeof item !== 'object') continue;
  const turns = [];
  let seq = 1;
  const addTurn = (who, channel, payload) => {
    turns.push({ seq: seq++, who, channel, payload });
  };

  addTurn('customer', 'chat', {
    msg: 'Diagnose this failed CzituchBot AI Live Benchmark case. Separate likely code defects from provider outages, quotas, timeouts, and missing telemetry.',
    case_id: item.id ?? null,
    category: item.category ?? null,
    benchmark_seed: report.seed ?? null
  });

  for (const [index, attempt] of (item.generationAttempts || []).entries()) {
    addTurn('agent', 'internal', {
      tool_call: {
        fn: 'benchmark.generation_attempt',
        kwargs: { index, attempt },
        request_id: `generation-${index + 1}`
      }
    });
    addTurn('system', 'internal', {
      tool_result: {
        request_id: `generation-${index + 1}`,
        status: attempt.status || 'unknown',
        data: attempt
      }
    });
  }

  for (const [index, event] of (item.timingTrace || []).entries()) {
    addTurn('system', 'internal', {
      observation: {
        type: 'timing_event',
        index,
        event,
        note: 'Event order is preserved within timingTrace only.'
      }
    });
  }

  for (const [index, validator] of (item.validatorResults || []).entries()) {
    addTurn('agent', 'internal', {
      tool_call: {
        fn: 'benchmark.validator_result',
        kwargs: { index, validator },
        request_id: `validator-${index + 1}`
      }
    });
    addTurn('system', 'internal', {
      tool_result: {
        request_id: `validator-${index + 1}`,
        status: validator.status || 'unknown',
        data: validator
      }
    });
  }

  addTurn('system', 'internal', {
    observation: {
      type: 'final_benchmark_evaluation',
      judge_status: item.judgeStatus ?? null,
      final_status: item.finalStatus ?? null,
      rejection_reason: item.rejectionReason ?? null,
      factual_passed: item.factualPassed ?? null,
      false_reject: item.falseReject ?? false,
      missing: item.missing ?? [],
      factual_missing: item.factualMissing ?? [],
      factual_forbidden: item.factualForbidden ?? [],
      fallback_reasons: item.fallbackReasons ?? [],
      model_calls: item.modelCalls ?? null,
      generation_budget: item.generationBudget ?? null,
      answer: item.answer ?? null,
      discarded_answer: item.discardedAnswer ?? null
    }
  });

  addTurn('agent', 'chat', {
    msg: 'End of recorded benchmark evidence. Diagnose only what the evidence supports; identify missing telemetry when root cause is uncertain.'
  });

  const id = String(item.id ?? `case-${written.length + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const trajectory = {
    meta: {
      session_id: `czituchbot-${id}`,
      platform: 'CzituchBot AI Live Benchmark',
      source_commit: process.env.GITHUB_SHA || null,
      benchmark_seed: report.seed ?? null,
      synthesized_from_benchmark_record: true,
      chronology_warning: 'Generation attempts, timingTrace and validatorResults are ordered within their own arrays only; the source report does not guarantee exact cross-array chronology.'
    },
    goal_description: `Diagnose failed benchmark case ${id}. Classify the failure, identify evidence-supported root cause and recommend a focused regression test.`,
    dialogue: {
      turns,
      resolution: {
        outcome: 'failed_benchmark_case',
        categories: [item.judgeStatus || 'unknown', item.finalStatus || 'unknown']
      }
    }
  };

  const file = path.join(outputDir, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(trajectory, null, 2)}\n`, { mode: 0o600 });
  written.push(file);
}

if (!written.length) throw new Error('No valid failed benchmark cases could be converted.');
console.log(`Prepared ${written.length} AgentRx input file(s): ${outputDir}/`);
