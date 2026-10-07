'use strict';

const NEGATION_RE = /\b(?:nie|nigdy|brak|bez|żaden|żadna|żadne|never|no|not)\b/iu;
const CAUSAL_RE = /\b(?:bo|ponieważ|gdyż|dlatego|z\s+powodu|w\s+celu|żeby|aby|chciał(?:a|o)?|chcia(?:ł|ła|li)|celem|because|therefore|due\s+to)\b/iu;
const TEMPORAL_RE = /\b(?:19|20)\d{2}\b|\b(?:styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień|wrzesień|październik|listopad|grudzień)\b|\b(?:wczoraj|dzisiaj|jutro|today|yesterday|tomorrow)\b/iu;

function normalizujClaim(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenyClaim(value) {
  return [...new Set(normalizujClaim(value).split(' ').filter(t => t.length >= 4))];
}
function wyodrebnijLiczbyIDaty(value) {
  const text = normalizujClaim(value);
  return [...new Set(text.match(/\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?%?\b/g) || [])];
}
function wyodrebnijNazwyWlasne(value) {
  const raw = String(value || '');
  const matches = raw.match(/\b[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*){0,3}/gu) || [];
  return [...new Set(matches.map(normalizujClaim).filter(x => x.length >= 3))];
}
function wyodrebnijMarkery(value, regex) {
  return regex.test(normalizujClaim(value));
}
function zgodnoscStrukturalna(evidence, claim) {
  const e = String(evidence || '');
  const c = String(claim || '');
  if (!e.trim() || !c.trim()) return { ok: false, reason: 'brak dowodu lub claimu' };

  const evidenceNumbers = wyodrebnijLiczbyIDaty(e);
  const claimNumbers = wyodrebnijLiczbyIDaty(c);
  if (claimNumbers.length && claimNumbers.some(n => !evidenceNumbers.includes(n))) {
    return { ok: false, reason: 'claim zawiera liczbę/datę nieobecną w dowodzie' };
  }

  const claimNegated = wyodrebnijMarkery(c, NEGATION_RE);
  const evidenceNegated = wyodrebnijMarkery(e, NEGATION_RE);
  if (claimNegated !== evidenceNegated) return { ok: false, reason: 'claim i dowód mają inną negację' };

  const claimCausal = wyodrebnijMarkery(c, CAUSAL_RE);
  const evidenceCausal = wyodrebnijMarkery(e, CAUSAL_RE);
  if (claimCausal && !evidenceCausal) return { ok: false, reason: 'claim dodaje relację przyczynową nieobecną w dowodzie' };

  const claimTemporal = wyodrebnijMarkery(c, TEMPORAL_RE);
  const evidenceTemporal = wyodrebnijMarkery(e, TEMPORAL_RE);
  if (claimTemporal && !evidenceTemporal && claimNumbers.length === 0) {
    return { ok: false, reason: 'claim zawiera sygnał czasowy nieobecny w dowodzie' };
  }

  const claimEntities = wyodrebnijNazwyWlasne(c);
  const evidenceNormalized = normalizujClaim(e);
  if (claimEntities.length) {
    const missingEntities = claimEntities.filter(entity => !evidenceNormalized.includes(entity));
    if (missingEntities.length > 0) return { ok: false, reason: 'dowód nie zawiera wszystkich istotnych nazw własnych claimu' };
  }

  const ct = tokenyClaim(c);
  const et = new Set(tokenyClaim(e));
  const overlap = ct.length ? ct.filter(t => et.has(t)).length / ct.length : 0;
  const threshold = ct.length <= 5 ? 0.67 : 0.60;
  if (overlap < threshold) return { ok: false, reason: `zbyt małe pokrycie semantyczne (\${overlap.toFixed(2)} < \${threshold.toFixed(2)})` };
  return { ok: true, overlap };
}
function czyDowodSemantyczniePokrywaClaim(evidence, claim) {
  return zgodnoscStrukturalna(evidence, claim).ok;
}
module.exports = { normalizujClaim, tokenyClaim, wyodrebnijLiczbyIDaty, wyodrebnijNazwyWlasne, zgodnoscStrukturalna, czyDowodSemantyczniePokrywaClaim };
