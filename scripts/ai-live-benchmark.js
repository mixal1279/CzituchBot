'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildAnswerPlan } = require('../ai/answer-plan');
const { judgeAnswer } = require('../ai/answer-judge');
const { normalizeFactText, scoreGoldenFacts } = require('../ai/benchmark-scorer');
const { summarizeClaimSupportAudits } = require('../ai/claim-support');
const { resetProviderQuotaCooldowns } = require('../ai/fallback');
const { agregujMetrykiWalidatorow } = require('../ai/validator-telemetry');

if (require.main === module && process.env.AI_LIVE_BENCHMARK !== '1') {
  console.error('Live benchmark jest celowo zablokowany. Ustaw AI_LIVE_BENCHMARK=1.');
  process.exit(2);
}

const benchmark = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'ai-benchmark.json'), 'utf8'));
const defaultLimit = Math.min(10, benchmark.cases.length);
const requestedLimit = Number(process.env.AI_BENCHMARK_LIMIT);
const limit = Math.max(1, Math.min(benchmark.cases.length, Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit));
function resolveDelayMs(value, defaultMs = 8000) {
  if (value == null || String(value).trim() === '') return defaultMs;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : defaultMs;
}
const delayMs = resolveDelayMs(process.env.AI_BENCHMARK_DELAY_MS);
function stratifiedCases(all, requested, seed = 0) {
  if (requested >= all.length) return [...all];
  const offset = Math.max(0, Math.floor(Number(seed)) || 0);
  const groups = new Map();
  for (const item of all) {
    const key = item.category || 'uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  // Rotate each category deterministically so non-gold questions still vary by seed.
  if (offset) for (const bucket of groups.values()) {
    if (bucket.length > 1) bucket.push(...bucket.splice(0, offset % bucket.length));
  }

  const selected = [];
  const selectedIds = new Set();
  const goldCases = all.filter(item => item.expected?.factual?.independentGold === true);
  // One gold example in a five-case run is too weak to tell whether factual
  // accuracy improved. Reserve roughly one third of the sample for independent
  // gold facts, taking different categories before taking a second item from
  // the same category. Remaining slots stay category-stratified.
  const targetGoldCount = Math.min(goldCases.length, Math.max(1, Math.ceil(requested / 3)));
  const goldByCategory = new Map();
  for (const item of goldCases) {
    const key = item.category || 'uncategorized';
    if (!goldByCategory.has(key)) goldByCategory.set(key, []);
    goldByCategory.get(key).push(item);
  }
  const goldCategories = [...goldByCategory.keys()];
  if (offset && goldCategories.length > 1) {
    const shift = offset % goldCategories.length;
    goldCategories.push(...goldCategories.splice(0, shift));
  }
  for (const category of goldCategories) {
    if (selected.length >= targetGoldCount) break;
    const candidates = goldByCategory.get(category) || [];
    if (!candidates.length) continue;
    const item = candidates[offset % candidates.length];
    if (!selectedIds.has(item.id)) {
      selected.push(item);
      selectedIds.add(item.id);
    }
  }

  const keys = [...groups.keys()];
  let cursor = 0;
  while (selected.length < requested && keys.length) {
    const key = keys[cursor % keys.length];
    const bucket = groups.get(key);
    while (bucket.length && selectedIds.has(bucket[0].id)) bucket.shift();
    if (bucket.length) {
      const item = bucket.shift();
      selected.push(item);
      selectedIds.add(item.id);
      cursor++;
    } else {
      keys.splice(cursor % keys.length, 1);
    }
  }
  return selected;
}
const benchmarkSeed = Math.max(0, Math.floor(Number(process.env.AI_BENCHMARK_SEED)) || 0);
const cases = stratifiedCases(benchmark.cases, limit, benchmarkSeed);

// The gold case's game field is context for the bot, not just the judge.
// Without passing it to the production pipeline, short prompts like "Jak pokonać smoka?"
// are ambiguous and the benchmark can accidentally test retrieval for the wrong game.
function buildQuestionForBot(item) {
  const question = String(item?.question || '').trim();
  const game = String(item?.game || '').trim();
  if (!game || question.toLocaleLowerCase('pl-PL').includes(game.toLocaleLowerCase('pl-PL'))) return question;
  return `W grze ${game}: ${question}`;
}

function isFailureText(text) {
  const normalized = normalizeFactText(text);
  const refusalPatterns = [
    /^(?:benchmark\s+)?nie mam wystarczajacych danych(?:\s+(?:zeby|aby) odpowiedziec(?: na to)?(?: pewnie)?)?$/i,
    /^(?:benchmark\s+)?nie moge(?: wiarygodnie)? potwierdzic(?: tej informacji)?(?: wiec nie bede zgadywac)?$/i,
    /^(?:benchmark\s+)?chwilowo nie moge(?: wiarygodnie)? potwierdzic(?: tej informacji)?(?: wiec nie bede zgadywac)?$/i,
    /^(?:benchmark\s+)?nie bede zgadywac$/i,
    /^(?:benchmark\s+)?brakuje danych(?: referencyjnych)?$/i,
    /^(?:benchmark\s+)?nie jestem pewien(?: tej informacji)?$/i,
    /^(?:benchmark\s+)?nie wiem$/i,
    /^(?:benchmark\s+)?i (?:do not|don t) have enough (?:data|information)(?: to answer(?: this)?(?: confidently)?)?$/i,
    /^(?:benchmark\s+)?i (?:cannot|can t) (?:reliably )?(?:confirm|verify)(?: this information)?(?: so i (?:will not|won t) guess)?$/i,
    /^(?:benchmark\s+)?i (?:will not|won t) guess$/i,
    /^(?:benchmark\s+)?i (?:do not|don t) know$/i,
    /^(?:benchmark\s+)?i cannot answer that confidently$/i,
    /^(?:benchmark\s+)?insufficient (?:data|information)$/i,
    /^(?:benchmark\s+)?odpowiedz niezweryfikowana walidator jest niedostepny$/i,
  ];
  return refusalPatterns.some(pattern => pattern.test(normalized));
}

// Odrzucona treść: to, co pipeline wyrzucił w zamian za odmowę.
// Ostatni wynik walidatora, nie pierwszy — cykl naprawczy może przepisać
// odpowiedź, a to, co pipeline faktycznie wyrzucił, pochodzi z ostatniego
// werdyktu. Bot (czituch_bot.js) iteruje wstecz; benchmark musi tak samo,
// inaczej fałszywe odrzucenia byłyby liczone na innym tekście niż odrzucony.
function wybierzOdrzuconaOdpowiedz(summary, answered) {
  if (answered) return null;
  const rows = summary?.validatorResults || [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const candidate = rows[i]?.validationDiagnostics?.benchmarkTrace?.answer;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return null;
}

function evaluateBenchmarkAnswer(answer, item) {
  const text = String(answer || '');
  const plan = buildAnswerPlan(item.question, { ...item.routing, game: item.game });
  const judge = judgeAnswer(text, plan);
  const answered = Boolean(text.trim()) && !isFailureText(text);
  const abstained = Boolean(text.trim()) && !answered;
  return {
    answered,
    abstained,
    completeness: answered ? judge.score : 0,
    judgeStatus: answered ? judge.status : (abstained ? 'abstained' : 'unanswered'),
    judgeReason: answered ? judge.reason : (abstained ? 'pipeline returned a refusal instead of a substantive answer' : 'pipeline returned no answer'),
    missing: answered ? judge.missing : plan.requirements.map(requirement => requirement.id),
    judge,
  };
}

function isFalseReject(discardedEvaluation, discardedFactual, evaluation, item) {
  const hasIndependentGold = item?.expected?.factual?.independentGold === true;
  const discardedFactsPass = hasIndependentGold && discardedFactual?.passed === true;
  return Boolean(
    discardedEvaluation
    && discardedEvaluation.answered
    && discardedEvaluation.judgeStatus === 'accepted'
    && !evaluation.answered
    && discardedFactsPass
  );
}

function extractClaimSupportAudit(summary) {
  const audits = [];
  for (const row of summary?.validatorResults || []) {
    const audit = row?.validationDiagnostics?.claimSupport
      || row?.diagnostics?.claimSupport
      || row?.claimSupport;
    if (audit && Array.isArray(audit.records)) audits.push(audit);
  }
  return summarizeClaimSupportAudits(audits);
}

function writeBenchmarkReport(report, destination = process.env.AI_BENCHMARK_JSON_PATH) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('benchmark report must be a JSON object');
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  JSON.parse(serialized);
  if (!destination) return serialized;
  const outputPath = path.resolve(destination);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, outputPath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (_) {}
    throw error;
  }
  return serialized;
}

function writeStdoutAndWait(text, stream = process.stdout) {
  return new Promise((resolve, reject) => {
    try {
      stream.write(text, error => error ? reject(error) : resolve());
    } catch (error) {
      reject(error);
    }
  });
}

async function sleep(ms) {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

function isBenchmarkRunValid(diagnostics = {}) {
  // A technically completed run is not a valid quality measurement when a
  // provider outage, degraded fallback, or missing validator made it incomparable.
  return diagnostics.providerOutage !== true && diagnostics.qualityComparable !== false;
}

function classifyBenchmarkOutcome(result = {}) {
  const attempts = Array.isArray(result.generationAttempts) ? result.generationAttempts : [];
  const validatorResults = Array.isArray(result.validatorResults) ? result.validatorResults : [];
  const details = [
    result.rejectionReason,
    ...(Array.isArray(result.fallbackReasons) ? result.fallbackReasons : []),
    ...attempts.flatMap(attempt => [attempt.failure, attempt.error, attempt.reason, attempt.statusCode, attempt.code, attempt.message, attempt.timeoutAbort]),
    ...validatorResults.flatMap(row => [row.status, row.reason, row.error]),
  ].filter(Boolean).join(' ').toLowerCase();
  if (result.judgeStatus === 'accepted' && result.factualPassed !== false) return 'accepted';
  if (/(?:quota|rate.?limit|resource.?exhausted|tokens? per (?:day|minute)|\b429\b|\b402\b)/i.test(details)) return 'provider_quota';
  if (/(?:timeout|timed.?out|deadline|abort(?:ed)?|etimedout)/i.test(details)) return 'provider_timeout';
  if (/(?:budget_exhausted|budget|budżet|no_healthy_provider|request_deadline|model_calls_exhausted|generation_budget_exhausted)/i.test(details)) return 'no_fallback_budget';
  if (result.validatorResults?.some(row => row.safetyBlocked === true) || /(?:PROHIBITED_CONTENT|BLOCKLIST|finishReason=SAFETY|blockReason=SAFETY)/i.test(details)) return 'provider_safety_block';
  if (result.judgeStatus === 'error' || result.finalStatus === 'error') return 'pipeline_error';
  if (result.judgeStatus === 'abstained') return 'abstention';
  const evidenceRejected = /(?:evidence|quote|claim|unsupported|unverified|validator_reject|coverage|coarse)/i.test(details)
    || (result.finalStatus === 'rejected' && validatorResults.some(row =>
      /rejected/i.test(String(row.status || '')) && /(?:evidence|quote|claim|unsupported|unverified|negacj|sprzeczn|liczb|source.?id)/i.test(String(row.reason || '') + ' ' + JSON.stringify(row.localRejectReasons || []))
    ));
  if (evidenceRejected) return 'evidence_rejection';
  return 'semantic_rejection';
}

function formatBenchmarkFailureDiagnostics(results, limit = 20) {
  const failures = (Array.isArray(results) ? results : []).filter(result =>
    result.judgeStatus !== 'accepted' || result.factualPassed === false
  );
  if (failures.length === 0) return ['Brak niezaliczonych przypadków.'];

  const lines = [];
  for (const result of failures.slice(0, Math.max(1, limit))) {
    const reasons = [];
    const outcome = classifyBenchmarkOutcome(result);
    if (result.judgeStatus !== 'accepted') reasons.push(`judge=${result.judgeStatus || 'unknown'}`);
    if (result.finalStatus) reasons.push(`pipeline=${result.finalStatus}`);
    if (result.rejectionReason) reasons.push(String(result.rejectionReason));
    if (Array.isArray(result.missing) && result.missing.length) reasons.push(`braki: ${result.missing.join(', ')}`);
    if (Array.isArray(result.factualMissing) && result.factualMissing.length) reasons.push(`brakujące fakty: ${result.factualMissing.join(', ')}`);
    if (Array.isArray(result.factualForbidden) && result.factualForbidden.length) reasons.push(`niedozwolone fakty: ${result.factualForbidden.join(', ')}`);
    if (Array.isArray(result.fallbackReasons) && result.fallbackReasons.length) reasons.push(`fallback: ${result.fallbackReasons.join(', ')}`);
    for (const attempt of (result.generationAttempts || [])) {
      if (attempt.skipped === true || !['error', 'unavailable'].includes(String(attempt.status || '').toLowerCase())) continue;
      const detail = [attempt.failure, attempt.reason, attempt.message, attempt.statusCode, attempt.code]
        .filter(value => value !== undefined && value !== null && value !== '')
        .join(': ');
      reasons.push(`generator ${attempt.provider || 'unknown'}=${detail || attempt.status}`);
    }
    for (const row of (result.validatorResults || [])) {
      if (row.skipped === true) continue;
      const status = String(row.status || '').toLowerCase();
      const diagnostics = row.validationDiagnostics || row.diagnostics || {};
      if (['error', 'unavailable'].includes(status)) {
        const detail = [row.reason, row.error, row.statusCode, row.code]
          .filter(value => value !== undefined && value !== null && value !== '')
          .join(': ');
        reasons.push(`walidator ${row.provider || 'unknown'}=${detail || row.status}`);
      }

      // Rejected validators are the most useful part of a benchmark failure:
      // expose deterministic local gates and claim-level evidence problems,
      // not only transport failures. Keep each item short for Actions logs.
      if (status === 'rejected' || status === 'soft_accepted') {
        const localReasons = Array.isArray(diagnostics.localRejectReasons)
          ? diagnostics.localRejectReasons.filter(Boolean).slice(0, 4)
          : [];
        if (localReasons.length) {
          reasons.push(`walidator ${row.provider || 'unknown'} lokalne=${localReasons.join(', ')}`);
        }
        const unsupported = Array.isArray(diagnostics.unsupportedEvidenceClaims)
          ? diagnostics.unsupportedEvidenceClaims.slice(0, 3).map(item => {
            const ids = Array.isArray(item.sourceIds) ? item.sourceIds.join('/') : '';
            const why = Array.isArray(item.reasons) ? item.reasons.join(', ') : '';
            return `claim#${item.claimIndex ?? '?'}${ids ? ` [${ids}]` : ''}: ${why || 'dowód odrzucony'}`;
          })
          : [];
        for (const item of unsupported) reasons.push(`dowód ${item}`);

        const records = Array.isArray(diagnostics.claimSupport?.records)
          ? diagnostics.claimSupport.records
          : [];
        const problematic = records.filter(record =>
          record && !['entailed', 'supported'].includes(String(record.verdict || '').toLowerCase())
        ).slice(0, 2);
        for (const record of problematic) {
          const claim = String(record.claim || '').replace(/\s+/g, ' ').slice(0, 90);
          const why = String(record.reason || record.claimSourceVerdict || record.verdict || 'brak szczegółów').slice(0, 140);
          reasons.push(`claim#${record.claimIndex ?? '?'} ${record.verdict || 'unknown'}: ${why}${claim ? ` — ${claim}` : ''}`);
        }
      }
    }
    if (result.factualPassed === false) reasons.push(`gold facts ${result.factualScore ?? 0}`);
    const unique = [...new Set(reasons)];
    // Provider failures are actionable and must not be truncated behind
    // semantic/gold-fact details when a case has many diagnostics.
    const providerReasons = unique.filter(reason => /^(?:generator|walidator) /.test(reason));
    const otherReasons = unique.filter(reason => !/^(?:generator|walidator) /.test(reason));
    const uniqueReasons = [...otherReasons.slice(0, Math.max(0, 8 - providerReasons.length)), ...providerReasons].slice(0, 8);
    const detail = (uniqueReasons.length ? uniqueReasons : ['brak szczegółowej przyczyny w śladzie diagnostycznym']).join(' | ');
    lines.push(`- [${result.id || 'unknown'}] ${outcome}: ${detail}`.slice(0, 1200));
  }
  if (failures.length > limit) lines.push(`... oraz ${failures.length - limit} kolejnych niezaliczonych przypadków; pełne dane są w raporcie JSON.`);
  return lines;
}

function buildBenchmarkDiagnostics(results, allCases = benchmark.cases, selectedCases = cases) {
  const validatorRows = results.flatMap(result => result.validatorResults || []);
  const validatorProviderCalls = {};
  const validatorStatusCounts = {};
  for (const row of validatorRows) {
    const provider = String(row.provider || 'unknown');
    const status = row.skipped === true ? 'skipped' : (row.safetyBlocked === true ? 'safety_blocked' : String(row.status || 'unknown'));
    if (row.skipped !== true) validatorProviderCalls[provider] = (validatorProviderCalls[provider] || 0) + 1;
    validatorStatusCounts[status] = (validatorStatusCounts[status] || 0) + 1;
  }
  const classifyGenerationFailure = attempt => {
    if (attempt.failure && String(attempt.failure).toLowerCase() !== 'unknown') return String(attempt.failure).slice(0, 80);
    const detail = [attempt.error, attempt.reason, attempt.message, attempt.code, attempt.statusCode]
      .filter(value => value !== undefined && value !== null)
      .join(' ');
    if (/429|rate.?limit|quota|resource.?exhausted/i.test(detail)) return 'rate_limit';
    if (/timeout|timed out|deadline/i.test(detail) || attempt.timeoutAbort === true) return 'timeout';
    if (/abort|cancelled|canceled/i.test(detail)) return 'abort';
    if (/5\d\d/.test(detail)) return 'http_5xx';
    return 'unknown';
  };
  const generationProviderFailures = [...new Set(results.flatMap(result =>
    (result.generationAttempts || [])
      .filter(attempt => attempt.status === 'error')
      .map(attempt => `${attempt.provider}:${attempt.model}:${classifyGenerationFailure(attempt)}`)
  ))];
  const tavilyHttpEvents = results.flatMap(result =>
    (result.timingTrace || []).filter(event => event.stage === 'tavily_http_end')
  );
  const tavilyHttpFailuresByStatus = {};
  for (const event of tavilyHttpEvents.filter(item => item.ok !== true)) {
    const rawStatus = Number(event.httpStatus);
    const status = Number.isInteger(rawStatus) && rawStatus > 0 ? String(rawStatus) : 'unknown';
    tavilyHttpFailuresByStatus[status] = (tavilyHttpFailuresByStatus[status] || 0) + 1;
  }
  const tavilyHttpFailureRate = tavilyHttpEvents.length
    ? tavilyHttpEvents.filter(event => event.ok !== true).length / tavilyHttpEvents.length
    : 0;
  const generationCycleStarts = results.flatMap(result =>
    (result.timingTrace || []).filter(event => event.stage === 'generation_cycle_start')
  );
  const goldCases = allCases.filter(item => item.expected?.factual?.independentGold === true);
  const selectedGoldCases = selectedCases.filter(item => item.expected?.factual?.independentGold === true);
  // Only primary roles make the run invalid: Groq is the generation primary,
  // Gemini is the primary validator. Failures of secondary/fallback providers
  // are reported as degraded capability, not mistaken for a broken benchmark.
  const generationAttempts = results.flatMap(result =>
    (result.generationAttempts || [])
      .filter(attempt => attempt.skipped !== true && attempt.provider)
      .map(attempt => ({ provider: String(attempt.provider), status: attempt.status }))
  );
  const validatorAttempts = results.flatMap(result =>
    (result.validatorResults || [])
      .filter(row => row.skipped !== true && row.provider)
      .map(row => ({ provider: String(row.provider), status: row.safetyBlocked === true ? 'blocked' : row.status }))
  );
  const failedProvidersInRole = attempts => {
    const providers = [...new Set(attempts.map(attempt => attempt.provider))];
    return providers.filter(provider => {
      const providerRows = attempts.filter(attempt => attempt.provider === provider);
      return providerRows.length > 0 && providerRows.every(attempt =>
        attempt.status === 'error' || attempt.status === 'unavailable'
      );
    });
  };
  const failedGenerationProviders = failedProvidersInRole(generationAttempts);
  const failedValidatorProviders = failedProvidersInRole(validatorAttempts);
  const failedOutageProviders = [...new Set([
    ...failedGenerationProviders.filter(provider => provider === 'groq'),
    ...failedValidatorProviders.filter(provider => provider === 'gemini'),
  ])].sort();
  const degradedProviders = [...new Set([
    ...failedGenerationProviders.filter(provider => provider !== 'groq').map(provider => `${provider}:generation`),
    ...failedValidatorProviders.filter(provider => provider !== 'gemini').map(provider => `${provider}:validator`),
  ])].sort();
  const validatorCalls = validatorRows.filter(row => row.skipped !== true).length;
  const validatorSafetyBlocks = validatorRows.filter(row => row.safetyBlocked === true && row.skipped !== true).length;
  const validatorUnavailable = validatorRows.filter(row => row.status === 'unavailable' && row.safetyBlocked !== true && row.skipped !== true).length;
  const validatorAvailabilityChecks = validatorRows.filter(row => row.skipped !== true && row.safetyBlocked !== true).length;
  const validatorUnavailableRate = validatorAvailabilityChecks ? validatorUnavailable / validatorAvailabilityChecks : 0;
  const qualityDegradationReasons = [];
  if (failedOutageProviders.length > 0) qualityDegradationReasons.push('primary_provider_outage');
  if (validatorCalls === 0) qualityDegradationReasons.push('no_validator_calls');
  else if (validatorCalls < results.length) qualityDegradationReasons.push('validator_calls_below_case_count');
  if (validatorUnavailableRate > 0.25) qualityDegradationReasons.push('validator_unavailable_rate_above_25_percent');
  if (degradedProviders.length > 0) qualityDegradationReasons.push('fallback_provider_degradation');
  if (generationProviderFailures.length > 0) qualityDegradationReasons.push('generation_provider_errors');
  if (tavilyHttpFailureRate > 0.25) qualityDegradationReasons.push('tavily_http_failures_above_25_percent');
  const qualityComparable = qualityDegradationReasons.length === 0;
  const categories = [...new Set(allCases.map(item => item.category || 'uncategorized'))].sort();
  const goldCoverageByCategory = Object.fromEntries(categories.map(category => [
    category,
    {
      total: allCases.filter(item => (item.category || 'uncategorized') === category).length,
      independentGold: allCases.filter(item => (item.category || 'uncategorized') === category && item.expected?.factual?.independentGold === true).length,
    },
  ]));
  const outcomeCounts = {};
  for (const result of results) {
    const outcome = classifyBenchmarkOutcome(result);
    outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
  }
  return {
    validatorRejected: results.filter(result => result.finalStatus === 'rejected').length,
    validatorInconclusive: results.filter(result => result.finalStatus === 'inconclusive').length,
    // Licznik dotyczył końca REQUESTU, a nie wywołań walidatora: przy 5
    // odrzuconych przypadkach raportował 0, mimo że 7 z 12 wywołań walidatora
    // zakończyło się statusem 'unavailable'.
    validatorUnavailable,
    validatorSkipped: validatorRows.filter(row => row.skipped === true).length,
    requestsUnavailable: results.filter(result => result.finalStatus === 'unavailable').length,
    validatorCalls,
    validatorUnavailableRate: Number(validatorUnavailableRate.toFixed(3)),
    qualityComparable,
    qualityDegradationReasons,
    validatorProviderCalls,
    validatorStatusCounts,
    validatorSafetyBlocks,
    validatorSafetyBlockDetails: validatorRows
      .filter(row => row.safetyBlocked === true && row.skipped !== true)
      .map(row => ({ provider: row.provider || 'unknown', model: row.model || null, reason: row.reason || null, blockReason: row.blockReason || null, finishReason: row.finishReason || null })),
    validatorTransportFailures: validatorRows
      .filter(row => row.skipped !== true && row.safetyBlocked !== true && (row.status === 'unavailable' || row.status === 'error' || row.technicalError === true))
      .map(row => ({
        provider: row.provider || 'unknown', model: row.model || null, status: row.status || 'unknown',
        reason: row.reason || null, technicalError: row.technicalError === true,
        timeoutAbort: row.timeoutAbort === true, quota: row.quota === true,
        statusCode: Number.isInteger(Number(row.statusCode)) && row.statusCode != null ? Number(row.statusCode) : null,
      })),
    providerOutage: failedOutageProviders.length > 0,
    outageProviders: failedOutageProviders,
    degradedProviders,
    validatorSecondOpinions: results.reduce((sum, result) =>
      sum + (result.timingTrace || []).filter(event => event.stage === 'validator_second_opinion').length, 0),
    tavilyHttpCalls: tavilyHttpEvents.length,
    tavilyHttpFailures: tavilyHttpEvents.filter(event => event.ok !== true).length,
    tavilyHttpFailureRate: Number(tavilyHttpFailureRate.toFixed(3)),
    tavilyHttpFailuresByStatus,
    avgTavilyHttpMs: tavilyHttpEvents.length
      ? Math.round(tavilyHttpEvents.reduce((sum, event) => sum + Math.max(0, Number(event.durationMs) || 0), 0) / tavilyHttpEvents.length)
      : null,
    avgElapsedToGenerationCycleMs: generationCycleStarts.length
      ? Math.round(generationCycleStarts.reduce((sum, event) => sum + Math.max(0, Number(event.elapsedMs) || 0), 0) / generationCycleStarts.length)
      : null,
    repairUsed: results.filter(result => Number(result.generationBudget?.repairUsed || 0) > 0).length,
    repairSkipped: results.filter(result => Number(result.generationBudget?.repairUsed || 0) === 0 && result.finalStatus === 'rejected').length,
    avgModelCalls: results.filter(result => Number.isFinite(result.modelCalls)).length
      ? Number((results.filter(result => Number.isFinite(result.modelCalls)).reduce((sum, result) => sum + result.modelCalls, 0) / results.filter(result => Number.isFinite(result.modelCalls)).length).toFixed(2))
      : null,
    // Zachowujemy nazwę historyczną dla kompatybilności raportów; to są błędy generatora.
    providerFailures: generationProviderFailures,
    generationProviderFailures,
    outcomeCounts,
    goldCoverageByCategory,
    independentGoldCasesInBenchmark: goldCases.length,
    independentGoldCasesInSample: selectedGoldCases.map(item => item.id),
  };
}

async function run() {
  const { zapytajAI } = require('../czituch_bot');
  resetProviderQuotaCooldowns();
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
        buildQuestionForBot(item),
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

      const evaluation = evaluateBenchmarkAnswer(answer, item);
      const { judge } = evaluation;
      const factual = scoreGoldenFacts(answer, item.expected?.factual);
      // Odrzucona treść: jeśli pipeline wyrzucił odpowiedź w zamian za odmowę,
      // odpowiedź tę nadal mamy w diagnostyce walidatora. Oceniamy ją tym samym
      // sędzią — to jedyna podstawa, żeby policzyć FALSSZYWE odrzucenia
      // (wcześniej licznik był martwy, bo nic go nie wypełniało).
      const discardedAnswer = wybierzOdrzuconaOdpowiedz(summary, evaluation.answered);
      const discardedEvaluation = discardedAnswer
        ? evaluateBenchmarkAnswer(discardedAnswer, item)
        : null;
      const discardedFactual = discardedAnswer
        ? scoreGoldenFacts(discardedAnswer, item.expected?.factual)
        : null;
      const falseReject = isFalseReject(discardedEvaluation, discardedFactual, evaluation, item);
      results.push({
        id: item.id,
        category: item.category,
        answer,
        answered: evaluation.answered,
        abstained: evaluation.abstained,
        completeness: evaluation.completeness,
        judgeStatus: evaluation.judgeStatus,
        discardedAnswer,
        discardedJudgeStatus: discardedEvaluation ? discardedEvaluation.judgeStatus : null,
        discardedFactualScore: discardedFactual?.score ?? null,
        discardedFactualPassed: discardedFactual?.passed ?? null,
        falseReject,
        rejectionReason: [
          evaluation.judgeStatus !== 'accepted' ? evaluation.judgeReason : null,
          ...(summary?.validatorResults || [])
            .filter(result => result.status === 'rejected')
            .map(result => [result.reason, ...(result.validationDiagnostics?.localRejectReasons || [])].filter(Boolean).join(': ')),
          ...(summary?.fallbackReasons || []),
        ].filter(Boolean).join(' | ') || null,
        missing: evaluation.missing,
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
        claimSupport: extractClaimSupportAudit(summary),
        timingTrace: summary?.timingTrace || [],
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
        abstained: false,
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
        claimSupport: extractClaimSupportAudit(summary),
        timingTrace: summary?.timingTrace || [],
        fallbackReasons: summary?.fallbackReasons || [],
        tavilySearches: summary?.tavilySearches ?? null,
        sourceCount: summary?.sourceCount ?? null,
        error: String(error?.message || error),
      });
    }

    validatorMetricsRaw.push(...(summary?.validatorMetricsRaw || []));

    if ((i + 1) % 10 === 0 || i + 1 === cases.length) {
      const answeredCount = results.filter(x => x.answered).length;
      const completeCount = results.filter(x => x.judgeStatus === 'accepted').length;
      const answered = answeredCount / results.length;
      const complete = completeCount / results.length;
      console.error(`[LIVE BENCHMARK] ${i + 1}/${cases.length} answered=${answeredCount}/${results.length} (${(answered * 100).toFixed(1)}%) complete=${completeCount}/${results.length} (${(complete * 100).toFixed(1)}%)`);
    }
    if (i + 1 < cases.length) await sleep(delayMs);
  }

  const answered = results.filter(x => x.answered).length;
  const complete = results.filter(x => x.judgeStatus === 'accepted').length;
  const factualCases = results.filter(x => x.factualPassed !== null);
  const factualPassed = factualCases.filter(x => x.factualPassed).length;
  const factualAverage = factualCases.length ? factualCases.reduce((sum, x) => sum + x.factualScore, 0) / factualCases.length : null;
  const diagnostic = buildBenchmarkDiagnostics(results, benchmark.cases, cases);
  const providerOutage = Boolean(diagnostic.providerOutage);
  const claimSupport = summarizeClaimSupportAudits(results.map(result => result.claimSupport).filter(Boolean));
  // Fałszywe odrzucenia policzone tu, a nie w pipeline: to benchmark zna złoty
  // plan i sędziego, więc tylko on może orzec, że odrzucona odpowiedź była
  // poprawna. Pipeline tego nie wie i nie może wiedzieć.
  const falseRejects = results.filter(result => result.falseReject);
  const discardedAnswers = results.filter(result => result.discardedAnswer);
  // Keep semantic candidate acceptance visible even when independent gold facts
  // are incomplete. This is not counted as a false reject unless the strict
  // false-reject criteria (including independent gold facts) also pass.
  const discardedJudgeAccepted = discardedAnswers.filter(result => result.discardedJudgeStatus === 'accepted');
  const report = {
    benchmark: benchmark.name,
    mode: 'live',
    seed: benchmarkSeed,
    valid: isBenchmarkRunValid(diagnostic),
    total: results.length,
    answeredAccuracy: Number((answered / results.length).toFixed(4)),
    completenessAccuracy: Number((complete / results.length).toFixed(4)),
    falseRejects: falseRejects.length,
    falseRejectCaseIds: falseRejects.map(result => result.id),
    discardedAnswers: discardedAnswers.length,
    discardedAnswerCaseIds: discardedAnswers.map(result => result.id),
    discardedJudgeAcceptedCount: discardedJudgeAccepted.length,
    discardedJudgeAcceptedCaseIds: discardedJudgeAccepted.map(result => result.id),
    discardedJudgeAcceptedFactualPassedCount: discardedJudgeAccepted.filter(result => result.discardedFactualPassed === true).length,
    factualGoldCases: factualCases.length,
    factualAccuracy: factualCases.length ? Number((factualPassed / factualCases.length).toFixed(4)) : null,
    factualAverageScore: factualAverage === null ? null : Number(factualAverage.toFixed(4)),
    claimSupportPassRate: claimSupport.claimSupportPassRate,
    claimSupportUsableRate: claimSupport.claimSupportUsableRate,
    claimSupport,
    validatorMetrics: agregujMetrykiWalidatorow(validatorMetricsRaw),
    validatorMetricsRaw,
    durationMs: Date.now() - started,
    note: 'Ten testuje produkcyjny pipeline, kompletność odpowiedzi i osobny audyt wsparcia claim-cytat. Nie jest niezależnym pomiarem factual accuracy; do tego potrzebny jest ręcznie zweryfikowany gold answer/fact set.',
    categories: [...new Set(results.map(x => x.category))].sort(),
    diagnostics: diagnostic,
    failures: results.filter(x => !x.answered || x.judgeStatus !== 'accepted' || x.factualPassed === false).slice(0, 100),
  };
  const serializedReport = writeBenchmarkReport(report);
  if (!process.env.AI_BENCHMARK_JSON_PATH) await writeStdoutAndWait(serializedReport);
  if (!report.valid) {
    const reasons = [
      ...(diagnostic.outageProviders || []).map(provider => `provider outage: ${provider}`),
      ...(diagnostic.qualityDegradationReasons || []),
    ];
    console.error(`[LIVE BENCHMARK] WYNIK NIEWAŻNY / NIEPORÓWNYWALNY: ${reasons.join('; ') || 'niewystarczająca dostępność providerów'}.`);
    console.error('[LIVE BENCHMARK] Nie oceniaj jakości kodu po tym runie; sprawdź providerów i uruchom ponownie.');
    console.error('[LIVE BENCHMARK] Szczegóły niezaliczonych przypadków:');
    for (const line of formatBenchmarkFailureDiagnostics(results)) console.error(line);
    process.exitCode = 3;
    return;
  }
  if (process.env.AI_BENCHMARK_REQUIRE_PERFECT === '1') {
    // Tylko wybrane przypadki mają gold facts. Przy rotacji ziarnem może ich nie być w próbce.
    const factualOk = factualCases.length > 0 && factualPassed === factualCases.length;
    if (answered !== results.length || complete !== results.length || !factualOk) {
      console.error(`[LIVE BENCHMARK] wymagane ${results.length}/${results.length}; odpowiedzi=${answered}/${results.length}, kompletność=${complete}/${results.length}, factual=${factualPassed}/${factualCases.length}`);
      const gateReasons = [];
      if (answered !== results.length) gateReasons.push(`nieudzielone odpowiedzi ${answered}/${results.length}`);
      if (complete !== results.length) gateReasons.push(`niekompletne odpowiedzi ${complete}/${results.length}`);
      if (!factualOk) gateReasons.push(`gold facts niezaliczone lub brak gold case (${factualPassed}/${factualCases.length})`);
      console.error(`[LIVE BENCHMARK] PRZYCZYNY NIEPOWODZENIA: ${gateReasons.join('; ')}`);
      console.error('[LIVE BENCHMARK] Szczegóły per przypadek:');
      for (const line of formatBenchmarkFailureDiagnostics(results)) console.error(line);
      process.exitCode = 1;
    }
  }
}

module.exports = { isBenchmarkRunValid, resolveDelayMs,
  wybierzOdrzuconaOdpowiedz, normalizeFactText, scoreGoldenFacts, stratifiedCases, buildQuestionForBot, isFailureText, evaluateBenchmarkAnswer, isFalseReject, extractClaimSupportAudit, classifyBenchmarkOutcome, buildBenchmarkDiagnostics, formatBenchmarkFailureDiagnostics, writeBenchmarkReport, writeStdoutAndWait, run };

if (require.main === module) {
  run().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
