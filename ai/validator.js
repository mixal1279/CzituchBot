'use strict';
// CI regression: causal evidence contract.

const { assessEvidence } = require('./core');

const { sprawdzTwardeFaktyOdpowiedzi } = require('./response');
const { czyDowodSemantyczniePokrywaClaim, czyRelacjaPrzyczynowaPokrywaClaim, zgodnoscStrukturalna, sprawdzTwardeKonflikty, sprawdzSprzecznosciSemantyczne, sprawdzPokrycieClaimamiOdpowiedzi } = require('./claimValidation');
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

function buildBoundedSourceContext(sourceContent, quote, radius = 1) {
  const source = String(sourceContent || '').replace(/\s+/g, ' ').trim();
  const wantedQuote = String(quote || '').trim();
  if (!source || !wantedQuote) return '';

  const sentences = source
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\d"'“‘(\[])/u)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  if (!sentences.length) return quoteExists(source, wantedQuote) ? source : '';

  // Find the narrowest consecutive sentence window that contains the exact
  // authorized quote. Include only one adjacent sentence on either side so
  // pronouns and local causal context can resolve without importing unrelated
  // facts from the rest of a long page.
  const maxWidth = Math.min(6, sentences.length);
  for (let width = 1; width <= maxWidth; width++) {
    for (let start = 0; start + width <= sentences.length; start++) {
      const span = sentences.slice(start, start + width).join(' ');
      if (!quoteExists(span, wantedQuote)) continue;
      const contextStart = Math.max(0, start - Math.max(0, radius));
      const contextEnd = Math.min(sentences.length, start + width + Math.max(0, radius));
      return sentences.slice(contextStart, contextEnd).join(' ');
    }
  }

  // quoteExists was already checked against this block by the caller. A quote
  // that cannot be localized to a bounded sentence window should not authorize
  // a fallback to the entire source.
  return '';
}

function normalizujIdZrodla(value) {
  const raw = String(value || '').trim().replace(/^\[|\]$/g, '').trim();
  const normalized = raw.replace(/\s+/g, ' ').replace(/_/g, ' ').toLocaleUpperCase('en-US');
  const multiple = normalized.split(/\s*,\s*(?=(?:\[?\s*(?:SOURCE|REFERENCE)\b))/i).filter(Boolean);
  if (multiple.length > 1) return multiple.map(normalizujIdZrodla);
  const source = normalized.match(/^(?:\[?\s*)?SOURCE\s*#?\s*(\d+)\s*\]?$/i) || normalized.match(/^(\d+)$/);
  if (source) return `SOURCE ${source[1]}`;
  const reference = normalized.match(/^(?:\[?\s*)?REFERENCE\s+(.+?)\s*\]?$/i);
  if (reference) return `REFERENCE ${reference[1].trim()}`;
  return raw;
}

function czyDowodPotwierdzaClaim(dane, sourceIds, evidenceQuote, claim = '') {
  if (!Array.isArray(sourceIds) || !sourceIds.length || typeof evidenceQuote !== 'string') {
    return { ok: false, reason: 'brak poprawnego source_id lub evidence_quote' };
  }
  const quote = evidenceQuote.trim();
  if (quote.length < 12 || quote.length > 500) {
    return { ok: false, reason: 'evidence_quote ma nieprawidłową długość' };
  }

  const claimNorm = String(claim || '').toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
  const quoteNorm = claimNorm ? String(quote).toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l') : '';

  const causalRe = /(?:\b(?:bo|poniewaz|gdyz|dlatego|because|therefore|caused|causes|consequently|hence)\b|\b(?:as\s+a\s+result|led\s+to|leading\s+to|resulted\s+in|resulting\s+in|because\s+of|due\s+to|so\s+that|in\s+order\s+to|thereby|thus)\b|\b(?:allow(?:s|ed|ing)?|enabl(?:e|es|ed|ing)|which\s+(?:let|lets|allowed|allows|enabled|enables)|putting\s+(?:him|her|them|it)\s+in\s+control)\b|\bz\s+powodu\b|\bdzieki\b|\bspowodow\w*\b|\bdoprowadz\w*\b|\bumozliw\w*\b)/iu;
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
  // Causal and contextual synthesis must remain within a short sentence window
  // around the exact quote; do not allow distant text on the same page to support
  // an otherwise ungrounded claim.

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

    const sourceContext = buildBoundedSourceContext(block.content, quote, 1);
    const verificationContext = sourceContext || quote;

    // The evidence quote is guaranteed to exist in this authorized source, but
    // it may omit details (such as the date or a subject expressed in the prior
    // sentence). Validate hard conflicts against the bounded context, not the
    // isolated quote or the unbounded full page.
    const contextHard = sprawdzTwardeKonflikty(verificationContext, claim, {
      allowDistributedEvidence: true,
    });
    if (!contextHard.ok) {
      reasons.push(contextHard.reason || 'kontekst cytatu zawiera konflikt liczbowy, czasowy lub negację');
      continue;
    }
    const contextConflict = sprawdzSprzecznosciSemantyczne(verificationContext, claim);
    if (!contextConflict.ok) {
      reasons.push(contextConflict.reason || 'kontekst cytatu przeczy claimowi');
      continue;
    }

    if (claimCausal && !quoteCausal && !causalRe.test(verificationContext)) {
      reasons.push('claim dodaje relację przyczynową nieobecną w kontekście cytatu: ' + id);
      continue;
    }
    if (claimCausal && !quoteCausal && !czyRelacjaPrzyczynowaPokrywaClaim(verificationContext, claim)) {
      reasons.push('kontekst zawiera sygnał przyczynowy, ale nie wiąże go bezpośrednio z claimem: ' + id);
      continue;
    }

    const quoteStructural = zgodnoscStrukturalna(quote, claim, {
      allowCrossLanguageExactEvidence: true,
      allowDistributedEvidence: false,
    });
    if (quoteStructural.ok) {
      return { ok: true, sourceId: id, mode: 'exact_quote', reason: 'cytat występuje w źródle i bezpośrednio wspiera claim' };
    }

    // Bounded same-source synthesis supports local anaphora and facts stated in
    // immediately adjacent sentences without granting the entire page authority
    // to supply missing entities, dates, or causal relations from far away.
    if (sourceContext) {
      const contextStructural = zgodnoscStrukturalna(sourceContext, claim, {
        allowCrossLanguageExactEvidence: true,
        allowDistributedEvidence: true,
      });
      if (contextStructural.ok) {
        return {
          ok: true,
          sourceId: id,
          mode: 'source_context',
          reason: 'claim jest wsparty przez cytat i jego lokalny kontekst w tym samym źródle',
        };
      }
      reasons.push(contextStructural.reason || quoteStructural.reason || 'kontekst cytatu nie potwierdza claimu');
    } else {
      reasons.push(quoteStructural.reason || 'nie udało się ustalić kontekstu cytatu');
    }
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
      ? claim.source_ids.filter(v => typeof v === 'string' && v.trim()).flatMap(v => { const normalized = normalizujIdZrodla(v); return Array.isArray(normalized) ? normalized : [normalized]; }).map(v => v.slice(0, 80)).slice(0, 5)
      : [],
    evidence_quote: typeof claim?.evidence_quote === 'string' ? claim.evidence_quote.trim().slice(0, 500) : '',
    reason: typeof claim?.reason === 'string' ? claim.reason.trim().slice(0, 240) : '',
  })).filter(c => c.claim);

  const allowed = allowedSourceIds instanceof Set ? allowedSourceIds : null;
  const evidenceAssessment = assessEvidence(parseEvidenceBlocks(dane), answer || '', {
    intent: 'web_fact',
    is_lore: /lore|fabuł|histori|kanon|canon/i.test(String(answer || '')),
  });
  // Canonical evidence binding: trim an over-broad citation only when the exact quote
  // uniquely matches one of the model-cited, authorized blocks. Never repair a wholly
  // fabricated ID by searching unrelated sources; ambiguous quotes remain rejected.
  const parsedEvidenceBlocks = parseEvidenceBlocks(dane);
  const allowedBlocks = allowed
    ? parsedEvidenceBlocks.filter(block => allowed.has(block.sourceId))
    : parsedEvidenceBlocks;
  for (const claim of claims) {
    if (!claim.supported || !claim.evidence_quote || !claim.source_ids.length) continue;
    const citedIds = new Set(claim.source_ids.filter(id => !allowed || allowed.has(id)));
    const exactMatches = allowedBlocks.filter(block => citedIds.has(block.sourceId) && quoteExists(block.content, claim.evidence_quote));
    if (exactMatches.length === 1) claim.source_ids = [exactMatches[0].sourceId];
  }
  const unknownSourceClaimIndexes = claims.map((c, index) => c.supported && (!c.source_ids.length || (allowed && c.source_ids.some(id => !allowed.has(id)))) ? index : -1).filter(index => index >= 0);
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
  // The generator contract requires atomic factual claims. One broad claim must
  // not cover several answer sentences just because the answer's average score
  // passes a coarse sentence-count heuristic.
  const factualSentenceCount = Number(answerCoverage.checkedSentences || 0);
  const claimGranularityOk = !answer || !sentenceCount || sentenceCount <= 1
    ? true
    : answerCoverage.ok && claims.length >= Math.min(12, factualSentenceCount);
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
    ...(process.env.AI_LIVE_BENCHMARK === '1' ? {
      benchmarkTrace: {
        answer: String(answer || '').slice(0, 2500),
        claims: claims.map((claim, index) => ({
          claimIndex: index,
          claim: String(claim.claim || '').slice(0, 500),
          supported: claim.supported === true,
          sourceIds: Array.isArray(claim.source_ids) ? claim.source_ids : [],
          evidenceQuote: String(claim.evidence_quote || '').slice(0, 500),
          quoteVerified: Boolean(evidenceQuoteVerified[index]),
          supportVerified: Boolean(evidenceEvaluations[index]?.ok),
          supportReason: evidenceEvaluations[index]?.reason || null,
        })),
      },
    } : {}),
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
