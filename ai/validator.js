'use strict';
// CI regression: causal evidence contract.

const { assessEvidence } = require('./core');

const { sprawdzTwardeFaktyOdpowiedzi } = require('./response');
const { czyDowodSemantyczniePokrywaClaim, czyRelacjaPrzyczynowaPokrywaClaim, zgodnoscStrukturalna, sprawdzTwardeKonflikty, sprawdzPokrycieClaimamiOdpowiedzi } = require('./claimValidation');
const { parseEvidenceBlocks, quoteExists, rankEvidenceForClaim, buildEvidenceRepairContext } = require('./evidence');

// Kontrakt walidatora jest celowo mały: generator potrzebuje tylko jasnego
// werdyktu i konkretnej informacji zwrotnej do jednego retry.
const GEMINI_VALIDATOR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    reason: { type: 'string' },
    unsupported_claims: { type: 'array', items: { type: 'string' } },
    ok: { type: 'boolean' },
    supported: { type: 'boolean' },
    relevant: { type: 'boolean' },
    complete: { type: 'boolean' },
    hallucination: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          supported: { type: 'boolean' },
          source_ids: { type: 'array', items: { type: 'string' } },
          evidence_quote: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['claim', 'supported', 'source_ids', 'evidence_quote', 'reason'],
      },
    },
  },
  required: ['valid', 'reason', 'confidence', 'unsupported_claims', 'claims', 'supported', 'relevant', 'complete', 'hallucination'],
};

const VALIDATOR_JSON_SCHEMA = {
  ...GEMINI_VALIDATOR_JSON_SCHEMA,
  additionalProperties: false,
  properties: {
    ...GEMINI_VALIDATOR_JSON_SCHEMA.properties,
    claims: {
      ...GEMINI_VALIDATOR_JSON_SCHEMA.properties.claims,
      items: {
        ...GEMINI_VALIDATOR_JSON_SCHEMA.properties.claims.items,
        additionalProperties: false,
        required: ['claim', 'supported', 'source_ids', 'evidence_quote', 'reason'],
      },
    },
  },
};


function sprawdzKompletnoscOdpowiedzi(odpowiedz) {
  const text = String(odpowiedz || '').trim();
  if (!text) return { ok: false, reason: 'pusta odpowiedź' };
  if (/[,:;\-]$/.test(text)) return { ok: false, reason: 'odpowiedź kończy się w połowie zdania lub listy' };
  if (/\.{2,}$|…$/.test(text)) return { ok: false, reason: 'odpowiedź kończy się wielokropkiem' };
  if (/(?:^|\s)(?:i|oraz|albo|lub|a|ale|że|żeby|aby|który|która|które|którym|ponieważ|dlatego|następnie|potem)\s*$/iu.test(text)) return { ok: false, reason: 'odpowiedź kończy się niedokończonym łącznikiem' };
  const pairs = [['(', ')'], ['[', ']'], ['{', '}'], ['„', '”']];
  for (const [open, close] of pairs) {
    if ((text.split(open).length - 1) !== (text.split(close).length - 1)) return { ok: false, reason: 'odpowiedź ma niedomkniętą strukturę' };
  }
  const doubleQuotes = (text.match(/"/g) || []).length;
  if (doubleQuotes % 2 !== 0) return { ok: false, reason: 'odpowiedź ma niedomknięty cudzysłów' };
  return { ok: true, reason: 'odpowiedź wygląda na kompletną' };
}
function wytnijJsonWalidatora(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!t) return null;

  // Najpierw próbujemy cały tekst, potem pierwszy poprawny obiekt JSON.
  try { return JSON.parse(t); } catch (_) {}

  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < t.length; j++) {
      const ch = t[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(t.slice(i, j + 1)); } catch (_) { break; }
        }
      }
    }
  }
  return null;
}

function wyodrebnijIdentyfikatoryZrodel(dane) {
  const ids = new Set();
  const text = String(dane || '');
  for (const match of text.matchAll(/^\[SOURCE (\d+)\]\s*\r?\n(?=(?:TYP:\s*UNTRUSTED_WEB_DATA\s*\r?\n)?TYTUŁ:)/gmi)) ids.add(`SOURCE ${match[1]}`);
  for (const match of text.matchAll(/^\[REFERENCE ([^\]\r\n]+)\]\s*$/gmi)) ids.add(`REFERENCE ${match[1].trim()}`);
  return ids;
}

function pobierzBlokZrodla(dane, sourceId) {
  const lines = String(dane || '').split(/\r?\n/);
  const wanted = String(sourceId || '').trim();
  let active = false;
  const body = [];
  for (const line of lines) {
    const header = line.match(/^\[(SOURCE \d+|REFERENCE [^\]\r\n]+)\]\s*$/i);
    if (header) {
      if (active) break;
      active = header[1].trim() === wanted;
      continue;
    }
    if (active) body.push(line);
  }
  return active ? body.join('\n') : null;
}

function normalizujIdZrodla(value) {
  const raw = String(value || '').trim();
  // Models sometimes copy the visible header including square brackets.
  // Canonicalize [SOURCE 8], SOURCE 8, and 8 to the same internal ID.
  const match = raw.match(/^\[?\s*(?:SOURCE\s*)?(\d+)\s*\]?$/i);
  return match ? `SOURCE ${match[1]}` : raw;
}
function czyDowodPotwierdzaClaim(dane, sourceIds, evidenceQuote, claim = '') {
  if (!Array.isArray(sourceIds) || !sourceIds.length || typeof evidenceQuote !== 'string') {
    return { ok: false, reason: 'brak poprawnego source_id lub evidence_quote' };
  }
  const quote = evidenceQuote.trim();
  if (quote.length < 3 || quote.length > 500) {
    return { ok: false, reason: 'evidence_quote ma nieprawidłową długość' };
  }

  const claimNorm = String(claim || '').toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const quoteNorm = claimNorm ? String(quote).toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';

  const causalRe = /(?:\b(?:bo|poniewaz|gdyz|dlatego|celem|because|therefore)\b|\bz\s+powodu\b|\bw\s+celu\b|\bzeby\b|\baby\b|\bdzieki\b|\bbecause\s+of\b|\bdue\s+to\b|\bspowodow\w*\b|\bdoprowadz\w*\b|\bumozliw\w*\b)/iu;
  const claimCausal = causalRe.test(claimNorm);
  const quoteCausal = causalRe.test(quoteNorm);

  const quoteCaptured = /captur\w*|kidnapp\w*|abduct\w*|porwan\w*|schwyt\w*/i.test(quoteNorm);
  const quoteKilled = /kill\w*|murder\w*|zabij\w*|zabil\w*|zabila\w*|zabita\w*|zabite\w*|zabici\w*|zabity\w*|zabicie\w*|smier\w*/i.test(quoteNorm);
  const claimCaptured = /captur\w*|kidnapp\w*|abduct\w*|porwan\w*|schwyt\w*/i.test(claimNorm);
  const claimKilled = /kill\w*|murder\w*|zabij\w*|zabil\w*|zabila\w*|zabita\w*|zabite\w*|zabici\w*|zabity\w*|zabicie\w*|smier\w*/i.test(claimNorm)
    || claimNorm.includes('zabi');

  if (claimKilled && quoteCaptured && !quoteKilled) {
    return { ok: false, reason: 'claim zawiera zabójstwo, a evidence wskazuje jedynie schwytanie/porwanie' };
  }
  if (claimCaptured && quoteKilled && !quoteCaptured) {
    return { ok: false, reason: 'claim zawiera schwytanie/porwanie, a evidence wskazuje zabójstwo' };
  }
  // Causal claims are not rejected solely because the selected quote is a
  // non-causal excerpt. The full source block is checked below with
  // allowDistributedEvidence=true, so a supported synthesis across the source
  // remains valid while unsupported causal claims still fail semantic checks.

  const blocks = parseEvidenceBlocks(dane);
  const byId = new Map(blocks.map(block => [block.sourceId, block]));
  const reasons = [];

  for (const id of sourceIds) {
    const block = byId.get(id);
    if (!block) {
      reasons.push('source_id nie istnieje w danych referencyjnych: ' + id);
      continue;
    }
    if (!quoteExists(block.content, quote)) {
      reasons.push('evidence_quote nie występuje w wskazanym źródle: ' + id);
      continue;
    }

    // Causal synthesis is allowed when the full authorized source block
    // actually contains the causal relation, even if the selected quote is
    // only the event sentence. It is rejected when neither does.
    const blockNorm = String(block.content || '').toLocaleLowerCase('pl-PL')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (claimCausal && !quoteCausal && !causalRe.test(blockNorm)) {
      reasons.push('claim dodaje relację przyczynową nieobecną w całym źródle: ' + id);
      continue;
    }
    if (claimCausal && !quoteCausal && !czyRelacjaPrzyczynowaPokrywaClaim(block.content, claim)) {
      reasons.push('źródło zawiera sygnał przyczynowy, ale nie wiąże go bezpośrednio z claimem: ' + id);
      continue;
    }

    const quoteStructural = zgodnoscStrukturalna(quote, claim, {
      allowCrossLanguageExactEvidence: true,
      allowDistributedEvidence: false,
    });
    if (quoteStructural.ok) {
      return { ok: true, sourceId: id, mode: 'exact_quote', reason: 'cytat występuje w źródle i bezpośrednio wspiera claim' };
    }
    const supported = zgodnoscStrukturalna(block.content, claim, {
      allowCrossLanguageExactEvidence: true,
      allowDistributedEvidence: true,
    });
    if (supported.ok) {
      return {
        ok: true,
        sourceId: id,
        mode: 'source_context',
        reason: 'cytat jest rzeczywistym fragmentem źródła, a ten sam source block wspiera claim',
      };
    }
    reasons.push(supported.reason || 'evidence nie potwierdza claimu');
  }

  return { ok: false, reason: reasons[0] || 'brak zweryfikowanego evidence' };
}

function normalizujWynikWalidatora(wynik, model, provider = 'gemini', allowedSourceIds = null, dane = '', answer = '') {
  if (!wynik || typeof wynik !== 'object' || Array.isArray(wynik)) return null;

  // Validator produkcyjny ma ścisły kontrakt. Nie akceptujemy już starych,
  // częściowych payloadów, bo właśnie one tworzyły luki w fact-checkingu.
  if (typeof wynik.valid !== 'boolean') return null;
  if (typeof wynik.reason !== 'string') return null;
  if (!Array.isArray(wynik.unsupported_claims)) return null;
  if (!Array.isArray(wynik.claims) && !Array.isArray(wynik.claims_list)) return null;
  for (const key of ['supported', 'relevant', 'complete', 'hallucination']) {
    if (typeof wynik[key] !== 'boolean') return null;
  }
  if (typeof wynik.confidence !== 'number' || !Number.isFinite(wynik.confidence) || wynik.confidence < 0 || wynik.confidence > 1) return null;

  const validFromModel = typeof wynik.valid === 'boolean' ? wynik.valid : wynik.ok;
  const wymaganeBooleany = ['supported', 'relevant', 'complete', 'hallucination'];
  const maStarePola = wymaganeBooleany.every(key => typeof wynik[key] === 'boolean');
  const rawClaims = Array.isArray(wynik.claims)
    ? wynik.claims
    : (Array.isArray(wynik.claims_list) ? wynik.claims_list : []);
  const tooManyClaims = rawClaims.length > 12;
  const malformedClaimIndexes = rawClaims.map((claim, index) =>
    !claim || typeof claim !== 'object' || typeof claim.claim !== 'string' || typeof claim.supported !== 'boolean' || !Array.isArray(claim.source_ids) || typeof claim.evidence_quote !== 'string' ? index : -1
  ).filter(index => index >= 0);
  const malformedClaims = malformedClaimIndexes.length > 0;

  // Evidence quote is data, not a suggestion. Never replace an invalid quote
  // with a different candidate: doing so can turn an unsupported validator payload
  // into an accepted one. Normalization is handled by quoteExists itself.
  const reboundClaims = rawClaims.slice(0, 12);
  const claims = reboundClaims.map((claim) => ({
    claim: typeof claim?.claim === 'string' ? claim.claim.trim().slice(0, 500) : '',
    supported: claim?.supported === true,
    source_ids: Array.isArray(claim?.source_ids)
      ? claim.source_ids.filter(v => typeof v === 'string' && v.trim()).map(normalizujIdZrodla).map(v => v.slice(0, 80)).slice(0, 5)
      : [],
    evidence_quote: typeof claim?.evidence_quote === 'string' ? claim.evidence_quote.trim().slice(0, 500) : '',
    reason: typeof claim?.reason === 'string' ? claim.reason.trim().slice(0, 240) : '',
  })).filter(c => c.claim);

  const allowed = allowedSourceIds instanceof Set ? allowedSourceIds : null;
  const evidenceAssessment = assessEvidence(parseEvidenceBlocks(dane), answer || '', {
    intent: 'web_fact',
    is_lore: /lore|fabuł|histori|kanon|canon/i.test(String(answer || '')),
  });
  const unknownSourceClaimIndexes = claims.map((c, index) => c.supported && (!c.source_ids.length || (allowed && c.source_ids.some(id => !allowed.has(id)))) ? index : -1).filter(index => index >= 0);
  // Canonical evidence binding: the quoted span must resolve to an allowed source.
  // Semantic support is evaluated against that same source block, while quote integrity
  // and high-risk causal/action mismatches are checked deterministically.
  const parsedEvidenceBlocks = parseEvidenceBlocks(dane);
  const allowedBlocks = allowed
    ? parsedEvidenceBlocks.filter(block => allowed.has(block.sourceId))
    : parsedEvidenceBlocks;
  // Never silently rebind a validator claim to a different source just because
  // the same quote happens to occur there. The model must bind each claim to
  // the explicitly declared, allowed source IDs.
  const effectiveClaimSourceIds = claims.map(c =>
    Array.isArray(c.source_ids) ? c.source_ids : []
  );

  const evidenceEvaluations = claims.map((c, index) =>
    czyDowodPotwierdzaClaim(dane, effectiveClaimSourceIds[index], c.evidence_quote, c.claim)
  );
  const evidenceQuoteVerified = evidenceEvaluations.map(result => result.ok);
  const claimSourceVerified = evidenceEvaluations.map(result => result.ok);
  const unsupportedEvidenceClaimIndexes = claims
    .map((c, index) => c.supported && !claimSourceVerified[index] ? index : -1)
    .filter(index => index >= 0);
  const unverifiedEvidenceQuoteIndexes = claims
    .map((c, index) => c.supported && !evidenceQuoteVerified[index] ? index : -1)
    .filter(index => index >= 0);
  const unsupportedEvidenceReasons = unsupportedEvidenceClaimIndexes.map(index => ({
    claimIndex: index,
    reasons: [evidenceEvaluations[index]?.reason || 'brak zweryfikowanego evidence'],
  }));

  const unknownSourceClaim = unknownSourceClaimIndexes.length > 0;
  const unsupportedEvidenceClaim = unsupportedEvidenceClaimIndexes.length > 0;
  const answerCoverage = answer ? sprawdzPokrycieClaimamiOdpowiedzi(answer, claims) : { ok: true, uncovered: [], totalSentences: null, checkedSentences: null, uncoveredSentenceIndexes: [] };
  const unsupportedFromClaims = claims.filter(c => !c.supported).map(c => c.claim).filter(Boolean);
  const unsupported = [...new Set([
    ...unsupportedFromClaims,
    ...wynik.unsupported_claims
      .filter(v => typeof v === 'string' && v.trim())
      .map(v => v.trim().slice(0, 500)),
  ])].slice(0, 8);

  // Gdy stary model nie zwróci pól claim-by-claim, nie wymuszamy ich obecności
  // jako technicznego błędu. Nowy kontrakt nadal wymaga `valid/reason/unsupported_claims`.
  // W produkcji accepted wymaga jawnego rozpisania twierdzeń i źródeł.
  // Brak claims nie jest dowodem poprawności — jest niekompletnym wynikiem validatora.
  const claimCoverage = claims.length ? claims.filter(c => c.supported).length / claims.length : 0;
  const confidence = Math.max(0, Math.min(1,
    typeof wynik.confidence === 'number' ? wynik.confidence :
    claimCoverage * (maStarePola ? (wynik.complete === true ? 1 : 0.75) : 0.9)
  ));

  const sentenceCount = answerCoverage.totalSentences ?? null;
  const claimGranularityOk = !answer || !sentenceCount || sentenceCount <= 1
    ? true
    : answerCoverage.ok && claims.length >= Math.min(3, Math.ceil(sentenceCount / 3));
  const evidenceContractOk = !dane || !answer || evidenceAssessment.status !== 'weak' || (claims.length > 0 && unsupportedEvidenceClaimIndexes.length === 0 && unknownSourceClaimIndexes.length === 0 && evidenceAssessment.sourceCount >= 1);

  const claimContractOk = claims.length > 0
    && claims.every(c => c.supported)
    && !unknownSourceClaim
    && !unsupportedEvidenceClaim
    && unverifiedEvidenceQuoteIndexes.length === 0
    && !tooManyClaims
    && !malformedClaims
    && answerCoverage.ok
    && claimGranularityOk
    && evidenceContractOk
    && unsupported.length === 0;

  const accepted = validFromModel === true
    && confidence >= 0.75
    && claimContractOk
    && (!maStarePola || (
      wynik.supported === true
      && wynik.relevant === true
      && wynik.complete === true
      && wynik.hallucination === false
    ));

  // Częściowa odpowiedź jest dopuszczalna tylko z atomowych claimów, których
  // source_id, cytat i semantyczne wsparcie przeszły lokalną weryfikację.
  // Nie obniżamy progów dla sprzeczności, liczb/dat ani nieznanych źródeł.
  const verifiedPartialClaims = claims.filter((claim, index) =>
    claim.supported === true
    && evidenceEvaluations[index]?.ok === true
    && claim.source_ids.length > 0
    && !/[.!?].+\S/u.test(claim.claim)
  );
  const partialBody = verifiedPartialClaims.slice(0, 2)
    .map(claim => claim.claim.trim().replace(/[.!?]+$/u, ''))
    .filter(Boolean)
    .join('; ');
  const partialAnswerCandidate = partialBody
    ? partialBody + '. Nie wszystkie szczegóły da się potwierdzić w dostępnych źródłach.'
    : '';
  const partialHardFacts = partialBody
    ? sprawdzTwardeFaktyOdpowiedzi(partialBody + '.', dane, '')
    : { ok: false, unsupported: ['brak bezpiecznego claimu do odpowiedzi częściowej'] };
  const partialFormat = partialAnswerCandidate
    ? sprawdzKompletnoscOdpowiedzi(partialAnswerCandidate)
    : { ok: false };
  // Evidence failures are not interchangeable: quote-binding/format defects
  // may be omitted safely, but entity, negation, numeric, temporal, action, or
  // causal mismatches must not become a partial-acceptance trigger.
  const partialEligibleEvidenceFailureIndexes = unsupportedEvidenceClaimIndexes.filter(index => {
    const reasons = unsupportedEvidenceReasons.find(item => item.claimIndex === index)?.reasons || [];
    return reasons.length > 0 && reasons.every(reason =>
      /evidence_quote nie występuje w wskazanym źródle|evidence_quote ma nieprawidłową długość/i.test(reason)
    );
  });
  const hasPartialFailureTrigger = unsupported.length > 0
    || partialEligibleEvidenceFailureIndexes.length > 0;

  const partialAccepted = !accepted
    // Globalny werdykt może odrzucić całą odpowiedź przez jeden zły claim.
    // W trybie częściowym rozstrzygają lokalne dowody dla claimów, które zostaną
    // faktycznie pokazane; nie obniżamy progu confidence ani relevance.
    && confidence >= 0.75
    && wynik.relevant === true
    && claims.length > 0
    && verifiedPartialClaims.length > 0
    && hasPartialFailureTrigger
    && !unknownSourceClaim
    && !tooManyClaims
    && !malformedClaims
    && partialHardFacts.ok
    && partialFormat.ok;

  // Model może zwrócić sprzeczny werdykt: valid=false, ale jednocześnie
  // nie wskazać żadnego niepotwierdzonego twierdzenia i wszystkie claims
  // oznaczyć jako supported. To nie jest wiarygodny reject. Oznaczamy to
  // jako inconclusive, aby pipeline mógł użyć niezależnego validatora.
  const sprzecznyWerdykt = validFromModel === false
    && unsupported.length === 0
    && (!claims.length || claims.every(c => c.supported))
    && !unknownSourceClaim
    && !unsupportedEvidenceClaim
    && !tooManyClaims
    && !malformedClaims
    && answerCoverage.ok;

  const niekompletnyPozytywnyWerdykt = validFromModel === true
    && claims.length === 0
    && unsupported.length === 0
    && !unknownSourceClaim
    && !unsupportedEvidenceClaim;

  const localRejectReasons = [];
  if (!rawClaims.length) localRejectReasons.push('claims_missing');
  if (tooManyClaims) localRejectReasons.push('claims_over_limit');
  if (malformedClaims) localRejectReasons.push('malformed_claims');
  if (unknownSourceClaim) localRejectReasons.push('unknown_source_id');
  if (unsupportedEvidenceClaim) localRejectReasons.push('evidence_not_verified');
  if (unverifiedEvidenceQuoteIndexes.length) localRejectReasons.push('evidence_quote_not_exact');
  if (claims.some(c => !c.supported) || wynik.unsupported_claims.some(v => typeof v === 'string' && v.trim())) localRejectReasons.push('unsupported_claims_reported');
  if (!answerCoverage.ok) localRejectReasons.push('answer_not_covered_by_claims');
  if (!claimGranularityOk) localRejectReasons.push('claims_too_coarse_for_answer');
  if (validFromModel !== true) localRejectReasons.push('model_returned_invalid');
  if (confidence < 0.75) localRejectReasons.push('confidence_below_threshold');
  if (maStarePola && wynik.supported !== true) localRejectReasons.push('model_supported_false');
  if (maStarePola && wynik.relevant !== true) localRejectReasons.push('model_not_relevant');
  if (maStarePola && wynik.complete !== true) localRejectReasons.push('model_marked_incomplete');
  if (maStarePola && wynik.hallucination !== false) localRejectReasons.push('model_flagged_hallucination');

  // Partial/soft acceptance is intentionally disabled: every accepted response
  // must satisfy the complete local evidence contract.
  const status = accepted
    ? 'accepted'
    : (sprzecznyWerdykt || niekompletnyPozytywnyWerdykt ? 'inconclusive' : 'rejected');
  if (!localRejectReasons.length && !accepted) localRejectReasons.push('local_contract_not_satisfied');
  const diagnostics = {
    contractAccepted: accepted,
    partialAccepted,
    partialClaimCount: verifiedPartialClaims.length,
    modelValid: validFromModel === true,
    claimCoverage,
    rawClaimCount: rawClaims.length,
    normalizedClaimCount: claims.length,
    malformedClaimIndexes,
    unknownSourceClaimIndexes,
    unknownSourceClaims: unknownSourceClaimIndexes.map(index => ({ claimIndex: index, sourceIds: claims[index]?.source_ids || [] })),
    unsupportedEvidenceClaimIndexes,
    partialEligibleEvidenceFailureIndexes,
    unsupportedEvidenceClaims: unsupportedEvidenceClaimIndexes.map(index => ({ claimIndex: index, sourceIds: claims[index]?.source_ids || [], reasons: unsupportedEvidenceReasons.find(x => x.claimIndex === index)?.reasons || [] })),
    allowedSourceCount: allowed ? allowed.size : null,
    unsupportedClaimCount: unsupportedFromClaims.length,
    modelUnsupportedClaimCount: wynik.unsupported_claims.filter(v => typeof v === 'string' && v.trim()).length,
    answerCoverage: {
      ok: answerCoverage.ok,
      totalSentences: answerCoverage.totalSentences ?? null,
      checkedSentences: answerCoverage.checkedSentences ?? null,
      uncoveredSentenceIndexes: answerCoverage.uncoveredSentenceIndexes || [],
    },
    evidenceStatus: evidenceAssessment.status,
    evidenceBindings: claims.map((c, index) => ({
      claimIndex: index,
      sourceIds: c.source_ids,
      quoteVerified: Boolean(evidenceQuoteVerified[index]),
      supportVerified: Boolean(evidenceEvaluations[index]?.ok),
      mode: evidenceEvaluations[index]?.mode || null,
      reason: evidenceEvaluations[index]?.reason || null,
    })),
    evidenceSourceCount: evidenceAssessment.sourceCount,
    evidenceIndependentHosts: evidenceAssessment.independentHosts,
    localRejectReasons,
    evidenceRepairContext: unsupportedEvidenceClaimIndexes.length
      ? buildEvidenceRepairContext(unsupportedEvidenceClaimIndexes.map(index => claims[index]), allowedBlocks, allowed, 4)
      : '',
  };

  return {
    status,
    ok: accepted,
    valid: accepted,
    partialAnswer: null,
    technicalError: false,
    provider,
    model,
    supported: typeof wynik.supported === 'boolean' ? wynik.supported : accepted,
    relevant: typeof wynik.relevant === 'boolean' ? wynik.relevant : accepted,
    complete: accepted && (typeof wynik.complete === 'boolean' ? wynik.complete : accepted),
    hallucination: typeof wynik.hallucination === 'boolean' ? wynik.hallucination : !accepted,
    confidence,
    claims,
    unsupported_claims: unsupported,
    diagnostics,
    reason: partialAccepted
      ? 'odpowiedź częściowa nie spełnia pełnego kontraktu walidacji'
      : tooManyClaims
      ? 'validator zwrócił więcej claims niż obsługuje kontrakt'
      : malformedClaims
        ? 'validator zwrócił niekompletny lub błędnie uformowany claim'
        : unknownSourceClaim
          ? 'claim wskazuje nieistniejące lub niedozwolone źródło'
        : !answerCoverage.ok
          ? 'claims nie pokrywają całej odpowiedzi'
          : unsupportedEvidenceClaim
            ? (unsupportedEvidenceReasons.flatMap(x => x.reasons)[0] || 'co najmniej jeden claim nie jest potwierdzony przez wskazane źródło')
          : ((typeof wynik.reason === 'string' ? wynik.reason.trim().slice(0, 500) : '') || (accepted ? 'odpowiedź jest ugruntowana w danych' : 'odpowiedź zawiera niepotwierdzone twierdzenia')),
  };
}



module.exports = {
  VALIDATOR_JSON_SCHEMA,
  GEMINI_VALIDATOR_JSON_SCHEMA,
  wytnijJsonWalidatora,
  normalizujWynikWalidatora,
  wyodrebnijIdentyfikatoryZrodel,
  sprawdzTwardeFaktyOdpowiedzi,
  sprawdzKompletnoscOdpowiedzi,
};