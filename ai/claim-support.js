'use strict';

// First-class per-claim citation-support audit. This is deliberately separate
// from answer completeness and factual gold scoring: it measures whether each
// claim is supported by its own cited span and records why it was not.
const { CAUSAL_RE, CAUSAL_EVIDENCE_RE } = require('./claimValidation');
const MAX_CONTEXT_LENGTH = 2000;
const HARD_OVERCLAIM_TYPES = new Set([
  'correlation_to_causation',
  'hedge_to_absolute',
  'up_to_qualifier_dropped',
  'unsupported_quantifier',
  'speculation_presented_as_fact',
  'interpretation_presented_as_fact',
  'canon_status_not_in_evidence',
  'canon_status_conflict',
  'canon_status_not_official_source',
  'input_too_long',
]);

function normalizeText(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0142/g, 'l')
    .replace(/[^\p{L}\p{N}%+.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function czyMarkerNieJestZaprzeczony(tekst, indeks) {
  const prefix = tekst.slice(Math.max(0, indeks - 48), indeks);
  return /(?:\bnot\s+(?:a\s+)?|\bisn't\s+(?:a\s+)?|\bis\s+not\s+(?:a\s+)?|\bwasn't\s+(?:a\s+)?|\bwas\s+not\s+(?:a\s+)?|\bnever\s+(?:a\s+)?|\bno\s+longer\s+(?:a\s+)?|\bnot\s+(?:part\s+of|in)\s+|\bnie\s+(?:(?:jest|byl|byla|bylo|sa|stanowi|pozostaje)\s+)?|\bto\s+nie\s+(?:jest\s+)?|\bnie\s+nalezy\s+do\s+)$/u.test(prefix);
}

function znajdzStatusEpistemiczny(tekst, wzorzec) {
  const wzorzecWszystkie = new RegExp(wzorzec.source, wzorzec.flags.includes('g') ? wzorzec.flags : wzorzec.flags + 'g');
  let match;
  let pierwszy = null;
  let aktywne = false;
  while ((match = wzorzecWszystkie.exec(tekst))) {
    const marker = match[0].toLocaleLowerCase('pl-PL');
    const negatywnyPrefiks = czyMarkerNieJestZaprzeczony(tekst, match.index);
    const jawnieNegatywny = /^(?:non[- ]canonical|niekanoniczn)/u.test(marker);
    const pozytywny = !(negatywnyPrefiks || jawnieNegatywny);
    if (!pierwszy) pierwszy = { wystepuje: true, pozytywny, marker };
    if (pozytywny) aktywne = true;
  }
  return pierwszy
    ? { ...pierwszy, aktywne }
    : { wystepuje: false, aktywne: false, pozytywny: null, marker: null };
}

const THEORY_STATUS_RE = /(?:fan theor(?:y|ies)|theor(?:y|ies)\s+(?:suggest\w*|propos\w*|claim\w*|argu\w*|hold\w*)|speculat\p{L}*|rumou?r\p{L}*|unconfirmed|hypothes\p{L}*|teori\p{L}*\s+(?:fanowsk\p{L}*|zaklad\p{L}*|mow\p{L}*|sugeruj\p{L}*|glos\p{L}*|twierdz\p{L}*)|spekulacj\p{L}*|plotk\p{L}*|niepotwierdzon\p{L}*|hipotez\p{L}*|wedlug fanow|fani uwazaja|niektorzy gracze uwazaja)/giu;
const INTERPRETATION_STATUS_RE = /(?:interpretation\p{L}*|interpreted as|can be interpreted|fans interpret|interpretacj\p{L}*|interpretowan\p{L}*|mozna interpretowac|fani interpretuja|may symbolize|might symbolize|could symbolize|moze symbolizowac|moze oznaczac)/giu;
const CANON_STATUS_RE = /(?:non[- ]canonical|niekanoniczn\p{L}*|canon(?:ical(?:ly)?|ically)?|kanon\p{L}*)/giu;

function detectOverclaimTypes(claim, evidence, options = {}) {
  if (String(claim || '').length > 1000 || String(evidence || '').length > 2000) return ['input_too_long'];
  const c = normalizeText(claim);
  const e = normalizeText(evidence);
  // Kontekst jest opcjonalnym rozszerzeniem dowodu, więc nie może omijać limitów wejścia.
  // Zbyt długi kontekst pomijamy w całości — nie obcinamy go do fragmentu, który mógłby zmienić sens.
  const contextInput = String(options.context || '');
  const context = contextInput.length <= MAX_CONTEXT_LENGTH ? normalizeText(contextInput) : '';
  const types = [];
  if (!c || !e) return types;

  // Reuse claimValidation.js's shared causal-marker lists instead of a second,
  // independently maintained copy: a local copy previously drifted from the
  // main validator's CAUSAL_RE (missing markers such as 'corrupt'), which let
  // this overclaim check reject causal claims the main evidence check had
  // already accepted as supported.
  const causalClaim = CAUSAL_RE.test(c);
  const causalEvidence = CAUSAL_EVIDENCE_RE.test(e)
    || (options.allowContextForCausality === true && CAUSAL_EVIDENCE_RE.test(context));
  if (causalClaim && !causalEvidence) types.push('correlation_to_causation');

  // Lore: a quote explicitly framed as a fan theory, hypothesis or rumour
  // cannot support the same proposition stated as an established event.
  // The answer must preserve the epistemic label instead of dropping it.
  const theoryEvidence = znajdzStatusEpistemiczny(e, THEORY_STATUS_RE).aktywne;
  const theoryLabelInClaim = znajdzStatusEpistemiczny(c, THEORY_STATUS_RE).aktywne;
  if (theoryEvidence && !theoryLabelInClaim) types.push('speculation_presented_as_fact');

  // Preserve interpretation as interpretation. A symbolic/interpretive reading
  // is not a plot event merely because the same nouns appear in the quote.
  const interpretationEvidence = znajdzStatusEpistemiczny(e, INTERPRETATION_STATUS_RE).aktywne;
  const interpretationLabelInClaim = znajdzStatusEpistemiczny(c, INTERPRETATION_STATUS_RE).aktywne;
  if (interpretationEvidence && !interpretationLabelInClaim) types.push('interpretation_presented_as_fact');

  // A claim about canonical/official status needs that status stated in its
  // own cited span. Ordinary plot evidence does not prove canonicity.
  const canonClaimStatus = znajdzStatusEpistemiczny(c, CANON_STATUS_RE);
  const canonEvidenceStatus = znajdzStatusEpistemiczny(e, CANON_STATUS_RE);
  if (canonClaimStatus.wystepuje && !canonEvidenceStatus.wystepuje) {
    types.push('canon_status_not_in_evidence');
  } else if (canonClaimStatus.wystepuje && canonEvidenceStatus.wystepuje
    && canonClaimStatus.pozytywny !== canonEvidenceStatus.pozytywny) {
    types.push('canon_status_conflict');
  }
  // Status kanoniczny jest twierdzeniem o oficjalnym stanie uniwersum.
  // Wiki społecznościowa może opisywać kanon, ale sama nie jest źródłem
  // pierwotnym potwierdzającym jego status.
  if (canonClaimStatus.wystepuje && options.sourceAuthority
    && options.sourceAuthority !== 'official') {
    types.push('canon_status_not_official_source');
  }

  const sourceHedged = /\b(?:may|might|could|possibly|potentially|suggests?|appears? to|limited evidence|small study|moze|mozliwe|mozna(?:\s+byc)?|da\s+sie|bywa|prawdopodobnie|sugeruje|wstepne dane|niewielkim badaniu)\b/u.test(e);
  const claimAbsolute = /\b(?:always|never|proves?|guarantees?|definitely|certainly|undoubtedly|all|every|none|must|zawsze|nigdy|dowodzi|udowodniono|gwarantuje|bez watpienia|na pewno|wszyscy|wszystkie|kazdy|kazda|zaden|zadna)\b/u.test(c);
  const claimHedged = /\b(?:may|might|could|possibly|potentially|suggests?|appears? to|moze|mozliwe|mozna(?:\s+byc)?|da\s+sie|bywa|prawdopodobnie|sugeruje|wydaje sie)\b/u.test(c);
  // A source hedge alone does not make an ordinary declarative claim absolute.
  // Hard-fail only when the claim itself adds an explicit absolute/guarantee cue.
  const outcomeVerbPatterns = [
    /\b(?:improv\w*|popraw\w*)\b/u,
    /\b(?:increas\w*|zwieksz\w*)\b/u,
    /\b(?:reduc\w*|zmniejsz\w*)\b/u,
    /\b(?:caus\w*|powoduj\w*|spowod\w*)\b/u,
    /\b(?:prevent\w*|zapobieg\w*)\b/u,
  ];
  // A hedge plus a generic reporting verb ('shows', 'means') is not enough.
  // Require the unhedged claim and source to refer to the same outcome/action.
  const claimStatesSameOutcome = outcomeVerbPatterns.some(pattern => pattern.test(c) && pattern.test(e));
  const claimAddsUnqualifiedNumber = /\d+(?:[.,]\d+)?\s*%?/u.test(c) && !claimHedged;
  if (sourceHedged && !claimHedged && (claimAbsolute || claimStatesSameOutcome || claimAddsUnqualifiedNumber)) types.push('hedge_to_absolute');

  // Preserve qualifiers attached to numeric claims. "Up to 30%" is not the
  // same as an unqualified "30%". The numeric value must occur on both sides.
  const sourceUpTo = /\b(?:up to|at most|no more than|maximum of|do maksymalnie|maksymalnie do|maksymalnie)\s*\d+(?:[.,]\d+)?\s*%?|\bdo\s+\d+(?:[.,]\d+)?\s*%/u.test(e);
  const claimHasNumber = /\d+(?:[.,]\d+)?\s*%?/u.test(c);
  const claimPreservesUpperBound = /\b(?:up to|at most|no more than|maximum of|do maksymalnie|maksymalnie do|maksymalnie)\b|\bdo\s+\d+(?:[.,]\d+)?\s*%/u.test(c);
  if (sourceUpTo && claimHasNumber && !claimPreservesUpperBound) types.push('up_to_qualifier_dropped');

  const quantifierPatterns = [
    ['all', /\b(?:all|every|each|everyone|entirely|wszyscy|wszystkie|kazdy|kazda|calosc)\b/u],
    ['most', /\b(?:most|majority|predominantly|wiekszosc|przewaznie|zdecydowana wiekszosc)\b/u],
    ['only', /\b(?:only|solely|exclusively|wylacznie|jedynie|tylko)\b/u],
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

function buildClaimSupportAudit({ claims = [], evidenceEvaluations = [], evidenceQuoteVerified = [], evidenceQuotes = [], evidenceContexts = [], evidenceAuthorities = [] } = {}) {
  const records = claims.map((claim, index) => {
    const evaluation = evidenceEvaluations[index] || { ok: false, reason: 'brak lokalnej oceny dowodu' };
    const quoteVerified = evidenceQuoteVerified[index] === true;
    // Overclaim rules must inspect the exact cited span, not neighbouring sentences.
    // A nearby hedge or qualifier about another fact must not change this claim's verdict.
    const evidence = String(evidenceQuotes[index] || claim?.evidence_quote || '');
    const evidenceContext = String(evidenceContexts[index] || evidence);
    const overclaimTypes = detectOverclaimTypes(claim?.claim, evidence, {
      context: evidenceContext,
      // Same-source bounded context may resolve a causal relation only when the
      // structural verifier already accepted that exact claim as source_context.
      // Never let neighbouring text rescue an exact-quote overclaim.
      allowContextForCausality: evaluation.ok === true && evaluation.mode === 'source_context',
      sourceAuthority: evidenceAuthorities[index] || null,
    });
    const hardOverclaims = overclaimTypes.filter(type => HARD_OVERCLAIM_TYPES.has(type));
    const reason = String(evaluation.reason || claim?.reason || '').slice(0, 500);

    let verdict;
    if (!claim?.source_ids?.length || !claim?.evidence_quote || !quoteVerified) {
      verdict = 'unverifiable';
    } else if (hardOverclaims.length) {
      verdict = 'unsupported';
    } else if (evaluation.ok === true) {
      verdict = evaluation.mode === 'exact_quote' ? 'entailed' : 'partial';
    } else if (/negacj|sprzeczn|konflikt liczbow|warto[s\u015b][c\u0107] liczbow|relacj[e\u0119] przyczynow[a\u0105]/iu.test(reason)) {
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
      sourceAuthority: evidenceAuthorities[index] || 'unknown',
      verdict,
      claimSourceVerdict,
      reason: hardOverclaims.length
        ? 'claim zawiera mozliwe nadmierne wnioskowanie: ' + hardOverclaims.join(', ')
        : reason || (verdict === 'entailed' ? 'cytat bezposrednio wspiera claim' : 'brak wystarczajacego wsparcia w przypisanym cytacie'),
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
