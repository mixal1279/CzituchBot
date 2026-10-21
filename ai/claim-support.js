'use strict';

// First-class per-claim citation-support audit. This is deliberately separate
// from answer completeness and factual gold scoring: it measures whether each
// claim is supported by its own cited span and records why it was not.
const HARD_OVERCLAIM_TYPES = new Set([
  'correlation_to_causation',
  'hedge_to_absolute',
  'up_to_qualifier_dropped',
  'unsupported_quantifier',
]);

function normalizeText(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}%+.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectOverclaimTypes(claim, evidence) {
  const c = normalizeText(claim);
  const e = normalizeText(evidence);
  const types = [];
  if (!c || !e) return types;

  const causalClaim = /\b(?:because|therefore|caused? by|caus\w*|leads? to|resulted? in|as a result|dzieki temu|z powodu|poniewaz|dlatego|spowod\w*|doprowadz\w*|umozliw\w*)\b/u.test(c);
  const causalEvidence = /\b(?:because|therefore|caused? by|caus\w*|leads? to|resulted? in|as a result|due to|so that|in order to|dzieki temu|z powodu|poniewaz|dlatego|spowod\w*|doprowadz\w*|umozliw\w*|w wyniku)\b/u.test(e);
  if (causalClaim && !causalEvidence) types.push('correlation_to_causation');

  const sourceHedged = /\b(?:may|might|could|possibly|potentially|suggests?|appears? to|limited evidence|small study|moze|mozliwe|prawdopodobnie|sugeruje|wstepne dane|niewielkim badaniu)\b/u.test(e);
  const claimAbsolute = /\b(?:always|never|proves?|guarantees?|definitely|certainly|undoubtedly|all|every|none|must|zawsze|nigdy|dowodzi|udowodniono|gwarantuje|bez watpienia|na pewno|wszyscy|wszystkie|kazdy|kazda|zaden|zadna)\b/u.test(c);
  const claimHedged = /\b(?:may|might|could|possibly|potentially|suggests?|appears? to|moze|mozliwe|prawdopodobnie|sugeruje|wydaje sie)\b/u.test(c);
  // A source hedge alone does not make an ordinary declarative claim absolute.
  // Hard-fail only when the claim itself adds an explicit absolute/guarantee cue.
  if (sourceHedged && !claimHedged && claimAbsolute) types.push('hedge_to_absolute');

  // Preserve qualifiers attached to numeric claims. "Up to 30%" is not the
  // same as an unqualified "30%". The numeric value must occur on both sides.
  const sourceUpTo = /\b(?:up to|at most|no more than|maximum of|do maksymalnie|maksymalnie do|maksymalnie)\s*\d+(?:[.,]\d+)?\s*%?|\bdo\s+\d+(?:[.,]\d+)?\s*%/u.test(e);
  const claimHasNumber = /\d+(?:[.,]\d+)?\s*%?/u.test(c);
  const claimPreservesUpperBound = /\b(?:up to|at most|no more than|maximum of|do maksymalnie|maksymalnie do|maksymalnie)\b|\bdo\s+\d+(?:[.,]\d+)?\s*%/u.test(c);
  if (sourceUpTo && claimHasNumber && !claimPreservesUpperBound) types.push('up_to_qualifier_dropped');

  const quantifierPatterns = [
    ['all', /\b(?:all|every|everyone|entirely|wszyscy|wszystkie|kazdy|kazda|calosc)\b/u],
    ['most', /\b(?:most|majority|predominantly|wiekszosc|przewaznie|zdecydowana wiekszosc)\b/u],
    ['only', /\b(?:only|solely|exclusively|wyłącznie|wylacznie|jedynie|tylko)\b/u],
    ['always', /\b(?:always|never|zawsze|nigdy)\b/u],
  ];
  for (const [, pattern] of quantifierPatterns) {
    if (pattern.test(c) && !pattern.test(e)) {
      types.push('unsupported_quantifier');
      break;
    }
  }

  const currentClaim = /\b(?:currently|today|as of now|latest|current|nowadays|obecnie|aktualnie|dzisiaj|najnowsz\w*)\b/u.test(c);
  const years = [...e.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => Number(match[0]));
  const newestYear = years.length ? Math.max(...years) : null;
  const currentEvidence = /\b(?:currently|as of \d{4}|updated|latest|obecnie|aktualizowan\w*|stan na \d{4})\b/u.test(e);
  if (currentClaim && newestYear !== null && newestYear <= new Date().getUTCFullYear() - 2 && !currentEvidence) {
    types.push('stale_source_as_current');
  }

  return [...new Set(types)];
}

function buildClaimSupportAudit({ claims = [], evidenceEvaluations = [], evidenceQuoteVerified = [], evidenceQuotes = [], evidenceContexts = [] } = {}) {
  const records = claims.map((claim, index) => {
    const evaluation = evidenceEvaluations[index] || { ok: false, reason: 'brak lokalnej oceny dowodu' };
    const quoteVerified = evidenceQuoteVerified[index] === true;
    // Overclaim rules must inspect the exact cited span, not neighbouring sentences.
    // A nearby hedge or qualifier about another fact must not change this claim's verdict.
    const evidence = String(evidenceQuotes[index] || claim?.evidence_quote || '');
    const evidenceContext = String(evidenceContexts[index] || evidence);
    const overclaimTypes = detectOverclaimTypes(claim?.claim, evidence);
    const hardOverclaims = overclaimTypes.filter(type => HARD_OVERCLAIM_TYPES.has(type));
    const reason = String(evaluation.reason || claim?.reason || '').slice(0, 500);

    let verdict;
    if (!claim?.source_ids?.length || !claim?.evidence_quote || !quoteVerified) {
      verdict = 'unverifiable';
    } else if (hardOverclaims.length) {
      verdict = 'unsupported';
    } else if (evaluation.ok === true) {
      verdict = evaluation.mode === 'exact_quote' ? 'entailed' : 'partial';
    } else if (/negacj|sprzeczn|konflikt liczbow|warto[sś][cć] liczbow|relacj[eę] przyczynow[aą]/iu.test(reason)) {
      verdict = 'contradicted';
    } else {
      verdict = 'unsupported';
    }

    // Normalized citation-level outcome for downstream RAG evaluation.
    // Keep the legacy verdict above to avoid breaking existing dashboards.
    const claimSourceVerdict = verdict === 'entailed'
      ? 'supported'
      : verdict === 'partial'
        ? 'partial'
        : verdict === 'contradicted'
          ? 'contradicted'
          : verdict === 'unverifiable'
            ? 'not_enough_evidence'
            : 'unsupported_by_cited_source';

    const warnings = overclaimTypes.map(type => ({ type, severity: HARD_OVERCLAIM_TYPES.has(type) ? 'error' : 'warning' }));
    return {
      claimIndex: index,
      claim: String(claim?.claim || '').slice(0, 500),
      sourceIds: Array.isArray(claim?.source_ids) ? claim.source_ids.slice(0, 5) : [],
      evidenceQuote: String(claim?.evidence_quote || '').slice(0, 500),
      evidenceContext: evidenceContext.slice(0, 1200),
      modelSupported: claim?.supported === true,
      quoteVerified,
      localEvidenceVerified: evaluation.ok === true,
      supportMode: evaluation.mode || null,
      verdict,
      claimSourceVerdict,
      reason: hardOverclaims.length
        ? 'claim zawiera możliwe nadmierne wnioskowanie: ' + hardOverclaims.join(', ')
        : reason || (verdict === 'entailed' ? 'cytat bezpośrednio wspiera claim' : 'brak wystarczającego wsparcia w przypisanym cytacie'),
      overclaimTypes,
      warnings,
    };
  });

  const total = records.length;
  const count = verdict => records.filter(record => record.verdict === verdict).length;
  const entailed = count('entailed');
  const partial = count('partial');
  const unsupported = count('unsupported');
  const contradicted = count('contradicted');
  const unverifiable = count('unverifiable');
  return {
    version: 1,
    unit: 'claim_cited_span',
    totalClaims: total,
    verdictCounts: { entailed, partial, unsupported, contradicted, unverifiable },
    claimSourceVerdictCounts: {
      supported: records.filter(record => record.claimSourceVerdict === 'supported').length,
      partial: records.filter(record => record.claimSourceVerdict === 'partial').length,
      contradicted: records.filter(record => record.claimSourceVerdict === 'contradicted').length,
      not_enough_evidence: records.filter(record => record.claimSourceVerdict === 'not_enough_evidence').length,
      unsupported_by_cited_source: records.filter(record => record.claimSourceVerdict === 'unsupported_by_cited_source').length,
    },
    // Strict pass rate counts only claims directly entailed by their exact span.
    claimSupportPassRate: total ? Number((entailed / total).toFixed(4)) : null,
    // Usable rate is reported separately so bounded-context/paraphrase support
    // never gets silently mixed into strict citation support.
    claimSupportUsableRate: total ? Number(((entailed + partial) / total).toFixed(4)) : null,
    overclaimCounts: Object.fromEntries([...new Set(records.flatMap(record => record.overclaimTypes))].sort().map(type => [
      type, records.filter(record => record.overclaimTypes.includes(type)).length,
    ])),
    records,
  };
}

function summarizeClaimSupportAudits(audits) {
  const valid = (Array.isArray(audits) ? audits : []).filter(audit => audit && Number.isFinite(audit.totalClaims));
  const records = valid.flatMap(audit => Array.isArray(audit.records) ? audit.records : []);
  const count = verdict => records.filter(record => record.verdict === verdict).length;
  const total = records.length;
  const overclaimTypes = [...new Set(records.flatMap(record => record.overclaimTypes || []))].sort();
  return {
    version: 1,
    unit: 'claim_cited_span',
    totalClaims: total,
    verdictCounts: {
      entailed: count('entailed'),
      partial: count('partial'),
      unsupported: count('unsupported'),
      contradicted: count('contradicted'),
      unverifiable: count('unverifiable'),
    },
    claimSourceVerdictCounts: Object.fromEntries(
      ['supported', 'partial', 'contradicted', 'not_enough_evidence', 'unsupported_by_cited_source'].map(verdict => [
        verdict, records.filter(record => record.claimSourceVerdict === verdict).length,
      ]),
    ),
    claimSupportPassRate: total ? Number((count('entailed') / total).toFixed(4)) : null,
    claimSupportUsableRate: total ? Number(((count('entailed') + count('partial')) / total).toFixed(4)) : null,
    overclaimCounts: Object.fromEntries(overclaimTypes.map(type => [type, records.filter(record => (record.overclaimTypes || []).includes(type)).length])),
    records,
  };
}

module.exports = {
  HARD_OVERCLAIM_TYPES,
  normalizeText,
  detectOverclaimTypes,
  buildClaimSupportAudit,
  summarizeClaimSupportAudits,
};
