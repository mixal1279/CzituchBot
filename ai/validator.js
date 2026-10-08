'use strict';

const { assessEvidence } = require('./core');

const { sprawdzTwardeFaktyOdpowiedzi } = require('./response');
const { czyDowodSemantyczniePokrywaClaim, zgodnoscStrukturalna, sprawdzPokrycieClaimamiOdpowiedzi } = require('./claimValidation');

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
        required: ['claim', 'supported', 'source_ids', 'evidence_quote'],
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

function parseEvidenceForCore(dane) {
  const text = String(dane || '');
  const blocks = [];
  const re = /^\[(SOURCE \d+|REFERENCE [^\]\r\n]+)\]\s*$/gmi;
  const matches = [...text.matchAll(re)];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const block = text.slice(start, end);
    const title = block.match(/TYTUŁ:\s*([^\r\n]+)/i)?.[1] || '';
    const url = block.match(/URL:\s*(https?:\/\/[^\s\r\n]+)/i)?.[1] || '';
    const content = block.match(/TREŚĆ:\s*<<<UNTRUSTED_SOURCE_CONTENT>>>\s*([\s\S]*?)<<<END_UNTRUSTED_SOURCE_CONTENT>>>/i)?.[1]
      || block.replace(/^[^\n]+\n/, '');

    blocks.push({
      sourceId: matches[i][1].trim(),
      title,
      url,
      content,
    });
  }

  return blocks;
}

function normalizujDowodTekstowy(value) {
  return String(value || '').toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function tokenyDowodu(value) {
  return [...new Set(normalizujDowodTekstowy(value).split(' ').filter(t => t.length >= 4))];
}
function czyDowodPotwierdzaClaim(dane, sourceIds, evidenceQuote, claim = '') {
  if (!Array.isArray(sourceIds) || !sourceIds.length || typeof evidenceQuote !== 'string') return false;
  const quote = evidenceQuote.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL');
  if (quote.length < 3 || quote.length > 500) return false;
  const claimNorm = claim ? String(claim).toLocaleLowerCase('pl-PL') : '';
  const quoteNorm = quote;
  const quoteCaptured = quoteNorm.includes('captured') || quoteNorm.includes('kidnapped') || quoteNorm.includes('abducted') || quoteNorm.includes('porwan') || quoteNorm.includes('schwyt');
  const quoteKilled = quoteNorm.includes('killed') || quoteNorm.includes('murdered') || quoteNorm.includes('zabij') || quoteNorm.includes('zabi') || quoteNorm.includes('śmier');
  const claimCaptured = claimNorm.includes('captured') || claimNorm.includes('kidnapped') || claimNorm.includes('abducted') || claimNorm.includes('porwan') || claimNorm.includes('schwyt');
  const claimKilled = claimNorm.includes('killed') || claimNorm.includes('murdered') || claimNorm.includes('zabij') || claimNorm.includes('zabi') || claimNorm.includes('śmier');
  if (claimKilled && quoteCaptured && !quoteKilled) return false;
  if (claimCaptured && quoteKilled && !quoteCaptured) return false;
  return sourceIds.some(id => {
    const block = pobierzBlokZrodla(dane, id);
    if (!block) return false;
    const normalizedBlock = block.replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL');
    if (normalizedBlock.includes(quote)) {
      // The quote may be only a partial excerpt and omit a full entity name
      // present elsewhere in the same source block (e.g. "Johnny" vs
      // "Johnny Silverhand"). Bind the claim to the whole verified source
      // block while still requiring the quoted text to come from that block.
      return zgodnoscStrukturalna(block, claim, { allowCrossLanguageExactEvidence: true, allowDistributedEvidence: true }).ok;
    }
    return czyDowodSemantyczniePokrywaClaim(block, quote, { allowCrossLanguageExactEvidence: true, allowDistributedEvidence: true })
      && zgodnoscStrukturalna(block, claim, { allowCrossLanguageExactEvidence: true, allowDistributedEvidence: true }).ok
      && czyDowodSemantyczniePokrywaClaim(block, claim, { allowCrossLanguageExactEvidence: true, allowDistributedEvidence: true });
  });
}

function normalizujIdZrodla(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(?:SOURCE\s*)?(\d+)$/i);
  return match ? `SOURCE ${match[1]}` : raw;
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

  const claims = rawClaims.slice(0, 12).map((claim) => ({
    claim: typeof claim?.claim === 'string' ? claim.claim.trim().slice(0, 500) : '',
    supported: claim?.supported === true,
    source_ids: Array.isArray(claim?.source_ids)
      ? claim.source_ids.filter(v => typeof v === 'string' && v.trim()).map(normalizujIdZrodla).map(v => v.slice(0, 80)).slice(0, 5)
      : [],
    evidence_quote: typeof claim?.evidence_quote === 'string' ? claim.evidence_quote.trim().slice(0, 500) : '',
    reason: typeof claim?.reason === 'string' ? claim.reason.trim().slice(0, 240) : '',
  })).filter(c => c.claim);

  const allowed = allowedSourceIds instanceof Set ? allowedSourceIds : null;
  const evidenceAssessment = assessEvidence(parseEvidenceForCore(dane), answer || '', {
    intent: 'web_fact',
    is_lore: /lore|fabuł|histori|kanon|canon/i.test(String(answer || '')),
  });
  const unknownSourceClaimIndexes = claims.map((c, index) => c.supported && (!c.source_ids.length || (allowed && c.source_ids.some(id => !allowed.has(id)))) ? index : -1).filter(index => index >= 0);
  // Weryfikujemy przede wszystkim claim względem wskazanego źródła. `evidence_quote` jest
  // dodatkowym bezpiecznikiem i diagnostyką, ale nie powinien powodować false rejectu,
  // gdy model podał parafrazę zamiast dosłownego fragmentu, a sam claim jest jednoznacznie
  // potwierdzony przez ten sam, dozwolony blok źródłowy.
  const evidenceQuoteVerified = claims.map((c) => czyDowodPotwierdzaClaim(dane, c.source_ids, c.evidence_quote, c.claim));
  const claimSourceVerified = claims.map((c) => c.source_ids.some(id => {
    const block = pobierzBlokZrodla(dane, id);
    return Boolean(block) && zgodnoscStrukturalna(block, c.claim, { allowCrossLanguageExactEvidence: true, allowDistributedEvidence: true }).ok;
  }));
  const unsupportedEvidenceClaimIndexes = claims.map((c, index) => c.supported && (!claimSourceVerified[index] || !evidenceQuoteVerified[index]) ? index : -1).filter(index => index >= 0);
  const unverifiedEvidenceQuoteIndexes = claims.map((c, index) => c.supported && !evidenceQuoteVerified[index] ? index : -1).filter(index => index >= 0);
  const unsupportedEvidenceReasons = unsupportedEvidenceClaimIndexes.map(index => {
    const claim = claims[index];
    const reasons = claim?.source_ids?.map(id => {
      const block = pobierzBlokZrodla(dane, id);
      return block ? zgodnoscStrukturalna(block, claim.claim, { allowCrossLanguageExactEvidence: true, allowDistributedEvidence: true }).reason : null;
    }).filter(Boolean) || [];
    return { claimIndex: index, reasons };
  });

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

  const status = accepted
    ? 'accepted'
    : (sprzecznyWerdykt || niekompletnyPozytywnyWerdykt ? 'inconclusive' : 'rejected');
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
  if (!localRejectReasons.length && !accepted) localRejectReasons.push('local_contract_not_satisfied');
  const diagnostics = {
    contractAccepted: accepted,
    modelValid: validFromModel === true,
    claimCoverage,
    rawClaimCount: rawClaims.length,
    normalizedClaimCount: claims.length,
    malformedClaimIndexes,
    unknownSourceClaimIndexes,
    unknownSourceClaims: unknownSourceClaimIndexes.map(index => ({ claimIndex: index, sourceIds: claims[index]?.source_ids || [] })),
    unsupportedEvidenceClaimIndexes,
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
    evidenceSourceCount: evidenceAssessment.sourceCount,
    evidenceIndependentHosts: evidenceAssessment.independentHosts,
    localRejectReasons,
  };

  return {
    status,
    ok: accepted,
    valid: accepted,
    technicalError: false,
    provider,
    model,
    supported: typeof wynik.supported === 'boolean' ? wynik.supported : accepted,
    relevant: typeof wynik.relevant === 'boolean' ? wynik.relevant : accepted,
    complete: typeof wynik.complete === 'boolean' ? wynik.complete : accepted,
    hallucination: typeof wynik.hallucination === 'boolean' ? wynik.hallucination : !accepted,
    confidence,
    claims,
    unsupported_claims: unsupported,
    diagnostics,
    reason: tooManyClaims
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