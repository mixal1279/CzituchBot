'use strict';

const { sprawdzTwardeFaktyOdpowiedzi } = require('./response');

// Kontrakt walidatora jest celowo mały: generator potrzebuje tylko jasnego
// werdyktu i konkretnej informacji zwrotnej do jednego retry.
const VALIDATOR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    reason: { type: 'string' },
    unsupported_claims: { type: 'array', items: { type: 'string' } },
    // Pola zachowane dla kompatybilności z istniejącym pipeline'em.
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
  for (const match of text.matchAll(/\[(SOURCE \d+|REFERENCE [^\]]+)\]/g)) ids.add(match[1]);
  return ids;
}

function normalizujWynikWalidatora(wynik, model, provider = 'gemini', allowedSourceIds = null, dane = '') {
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

  const claims = rawClaims.slice(0, 12).map((claim) => ({
    claim: typeof claim?.claim === 'string' ? claim.claim.trim().slice(0, 500) : '',
    supported: claim?.supported === true,
    source_ids: Array.isArray(claim?.source_ids)
      ? claim.source_ids.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().slice(0, 80)).slice(0, 5)
      : [],
    evidence_quote: typeof claim?.evidence_quote === 'string' ? claim.evidence_quote.trim().slice(0, 500) : '',
    reason: typeof claim?.reason === 'string' ? claim.reason.trim().slice(0, 240) : '',
  })).filter(c => c.claim);

  const allowed = allowedSourceIds instanceof Set ? allowedSourceIds : null;
  const unknownSourceClaim = claims.some(c => c.supported && (!c.source_ids.length || (allowed && c.source_ids.some(id => !allowed.has(id)))));
  const unsupportedEvidenceClaim = claims.some(c => c.supported && !czyDowodPotwierdzaClaim(dane, c.source_ids, c.evidence_quote));
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
  const claimContractOk = claims.length > 0
    && claims.every(c => c.supported)
    && !unknownSourceClaim
    && !unsupportedEvidenceClaim
    && unsupported.length === 0;

  const claimCoverage = claims.length ? claims.filter(c => c.supported).length / claims.length : 0;
  const confidence = Math.max(0, Math.min(1,
    typeof wynik.confidence === 'number' ? wynik.confidence :
    claimCoverage * (maStarePola ? (wynik.complete === true ? 1 : 0.75) : 0.9)
  ));

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
    && !unsupportedEvidenceClaim;

  const status = accepted ? 'accepted' : (sprzecznyWerdykt ? 'inconclusive' : 'rejected');

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
    reason: (typeof wynik.reason === 'string' ? wynik.reason.trim().slice(0, 500) : '') || (accepted ? 'odpowiedź jest ugruntowana w danych' : 'odpowiedź zawiera niepotwierdzone twierdzenia'),
  };
}



module.exports = {
  VALIDATOR_JSON_SCHEMA,
  wytnijJsonWalidatora,
  normalizujWynikWalidatora,
  wyodrebnijIdentyfikatoryZrodel,
  sprawdzTwardeFaktyOdpowiedzi,
};