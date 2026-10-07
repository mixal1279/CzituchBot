'use strict';

const NEGATION_RE = /\b(?:nie|nigdy|brak|bez|żaden|żadna|żadne|never|no|not)\b/iu;
const CAUSAL_RE = /\b(?:bo|ponieważ|gdyż|dlatego|z\s+powodu|w\s+celu|żeby|aby|chciał(?:a|o)?|chcia(?:ł|ła|li)|celem|because|therefore|due\s+to)\b/iu;
const TEMPORAL_RE = /\b(?:19|20)\d{2}\b|\b(?:styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień|wrzesień|październik|listopad|grudzień)\b|\b(?:wczoraj|dzisiaj|jutro|today|yesterday|tomorrow)\b/iu;
const CROSS_LANGUAGE_CONCEPTS = [
  ['porwanie', /kidnap\w*|abduct\w*|captur\w*|porwan\w*|uprowadz\w*/i],
  ['obrazenia', /injur\w*|wound\w*|hurt\w*|rann\w*|obraż\w*/i],
  ['zabojstwo', /kill\w*|murder\w*|death|dead|zabij\w*|zabil\w*|zabila\w*|zabici\w*|zabity\w*|zabicie\w*|zgin\w*|śmier\w*/i],
  ['konflikt', /conflict\w*|feud\w*|fight\w*|war\w*|hatred|hate\w*|konflikt\w*|walcz\w*|wojn\w*/i],
  ['zwiazek', /relationship\w*|girlfriend\w*|boyfriend\w*|partner\w*|romanc\w*|romantic\w*|involved|zwi[aą]zk\w*|zwiaz\w*|relacj\w*|dziewczyn\w*|chłopak\w*/i],
  ['pomoc', /help\w*|assist\w*|save\w*|rescu\w*|pomog\w*|pomaga\w*|urat\w*|ocal\w*/i],
  ['kontrola', /control\w*|take[s]?\s+over|command\w*|manipulat\w*|kontrol\w*|przej[aą]ł\w*|manipul\w*/i],
  ['porazka', /defeat\w*|beaten|overcome\w*|pokon\w*|pora[zż]k\w*/i],
  ['zdrada', /betray\w*|traitor\w*|zdradz\w*|zdrajc\w*/i],
  ['tworzenie', /creat\w*|develop\w*|build\w*|made\b|stworz\w*|tworz\w*|opracow\w*/i],
  ['praca', /work\w*|employ\w*|job\w*|prac\w*|zatrud\w*/i],
];
function pojeciaCrossLanguage(value) {
  const text = normalizujClaim(value);
  return new Set(CROSS_LANGUAGE_CONCEPTS.filter(([, re]) => re.test(text)).map(([name]) => name));
}

const COVERAGE_STOPWORDS = new Set(['jest','była','było','byli','został','została','zostało','oraz','który','która','które','przez','jako','jego','jej','this','that','with','from','were','was','have','has']);
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
const UNIT_ALIASES = new Map([
  ['h','hour'], ['hr','hour'], ['hrs','hour'], ['hour','hour'], ['hours','hour'], ['godzina','hour'], ['godziny','hour'], ['godzin','hour'], ['godz','hour'],
  ['min','minute'], ['mins','minute'], ['minute','minute'], ['minutes','minute'], ['minuta','minute'], ['minuty','minute'], ['minut','minute'],
  ['s','second'], ['sec','second'], ['second','second'], ['seconds','second'], ['sekunda','second'], ['sekundy','second'], ['sekund','second'],
  ['day','day'], ['days','day'], ['dzień','day'], ['dni','day'], ['dnia','day'],
  ['year','year'], ['years','year'], ['rok','year'], ['lata','year'], ['lat','year'],
  ['km','km'], ['kilometer','km'], ['kilometers','km'], ['kilometr','km'], ['kilometry','km'], ['kilometrów','km'],
  ['m','m'], ['meter','m'], ['meters','m'], ['metr','m'], ['metry','m'], ['metrów','m'],
  ['kg','kg'], ['kilogram','kg'], ['kilograms','kg'], ['kilogramów','kg'],
  ['gb','gb'], ['mb','mb'], ['tb','tb'], ['hz','hz'], ['fps','fps'],
  ['°c','celsius'], ['°f','fahrenheit'], ['zł','pln'], ['pln','pln'], ['usd','usd'], ['eur','eur'], ['%','percent'],
]);
function wyodrebnijJednostkoweWartosci(value) {
  const text = String(value || '').toLocaleLowerCase('pl-PL').replace(/,/g, '.');
  const unitPattern = '(?:°c|°f|%|zł|pln|usd|eur|gb|mb|tb|hz|fps|km|kg|h|hr|hrs|sec|mins?|hours?|minutes?|seconds?|godzin(?:a|y)?|godz|minut(?:a|y)?|sekund(?:a|y)?|days?|dzień|dni|dnia|years?|rok|lata|lat|kilometers?|kilometr(?:ów|y)?|meters?|metr(?:ów|y)?|kilograms?|kilogramów)';
  const out = [];
  const re = new RegExp(`(?:\\b(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})(?=$|[^\\p{L}\\p{N}])|(${unitPattern})(?=$|[^\\p{L}\\p{N}])\\s*(\\d+(?:\\.\\d+)?))`, 'giu');
  for (const m of text.matchAll(re)) {
    const amount = Number(m[1] || m[4]);
    const rawUnit = String(m[2] || m[3] || '').toLocaleLowerCase('pl-PL');
    const unit = UNIT_ALIASES.get(rawUnit);
    if (Number.isFinite(amount) && unit) out.push(`${amount}:${unit}`);
  }
  const shortUnitRe = /(?:\b(\d+(?:\.\d+)?)\s+(m|s)\b|\b(m|s)\s+(\d+(?:\.\d+)?))/giu;
  for (const m of text.matchAll(shortUnitRe)) {
    const amount = Number(m[1] || m[4]);
    const unit = UNIT_ALIASES.get(String(m[2] || m[3] || '').toLocaleLowerCase('pl-PL'));
    if (Number.isFinite(amount) && unit) out.push(`${amount}:${unit}`);
  }
  return [...new Set(out)];
}
function wyodrebnijNazwyWlasne(value) {
  const raw = String(value || '');
  const matches = raw.match(/\b[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*){0,3}/gu) || [];
  return [...new Set(matches.map(normalizujClaim).filter(x => x.length >= 3))];
}
function wyodrebnijMarkery(value, regex) {
  return regex.test(normalizujClaim(value));
}
function czyNazwaWlasnaWystepuje(entity, evidenceNormalized) {
  if (evidenceNormalized.includes(entity)) return true;
  const parts = entity.split(' ').filter(Boolean);
  if (parts.length !== 1 || entity.length < 6) return false;
  const stem = entity.slice(0, Math.max(5, entity.length - 2));
  return evidenceNormalized.split(' ').some(token => token.length >= stem.length && token.startsWith(stem));
}
function sprawdzTwardeKonflikty(evidence, claim, options = {}) {
  const e = String(evidence || '');
  const c = String(claim || '');
  const evidenceNegated = wyodrebnijMarkery(e, NEGATION_RE);
  const claimNegated = wyodrebnijMarkery(c, NEGATION_RE);
  if (!options.allowDistributedEvidence && claimNegated !== evidenceNegated) return { ok: false, reason: 'claim i dowód mają inną negację' };

  const evidenceNumbers = wyodrebnijLiczbyIDaty(e);
  const claimNumbers = wyodrebnijLiczbyIDaty(c);
  if (claimNumbers.some(n => !evidenceNumbers.includes(n))) return { ok: false, reason: 'claim zawiera liczbę/datę nieobecną w dowodzie' };

  const evidenceQuantities = wyodrebnijJednostkoweWartosci(e);
  const claimQuantities = wyodrebnijJednostkoweWartosci(c);
  if (claimQuantities.some(q => !evidenceQuantities.includes(q))) return { ok: false, reason: 'claim zawiera wartość liczbową z niezgodną lub niepotwierdzoną jednostką' };

  const claimTemporal = wyodrebnijMarkery(c, TEMPORAL_RE);
  const evidenceTemporal = wyodrebnijMarkery(e, TEMPORAL_RE);
  if (claimTemporal && !evidenceTemporal && claimNumbers.length === 0) return { ok: false, reason: 'claim zawiera sygnał czasowy nieobecny w dowodzie' };
  return { ok: true };
}

function sprawdzSprzecznosciSemantyczne(evidence, claim) {
  const eConcepts = pojeciaCrossLanguage(evidence);
  const cConcepts = pojeciaCrossLanguage(claim);
  const eAction = {
    captured: /captur\\w*|porwan\\w*|uprowadz\\w*|schwyt\\w*/i.test(normalizujClaim(evidence)),
    killed: /kill\\w*|murder\\w*|zabij\\w*|zabil\\w*|zabila\\w*|zabici\\w*|zabity\\w*|zabicie\\w*|śmier\\w*/i.test(normalizujClaim(evidence)),
  };
  const cAction = {
    captured: /captur\\w*|porwan\\w*|uprowadz\\w*|schwyt\\w*/i.test(normalizujClaim(claim)),
    killed: /kill\\w*|murder\\w*|zabij\\w*|zabil\\w*|zabila\\w*|zabici\\w*|zabity\\w*|zabicie\\w*|śmier\\w*/i.test(normalizujClaim(claim)),
  };
  if (cAction.killed && eAction.captured && !eAction.killed) return { ok: false, reason: 'claim zawiera zabójstwo, a dowód potwierdza jedynie schwytanie/porwanie' };
  if (cAction.captured && eAction.killed && !eAction.captured) return { ok: false, reason: 'claim zawiera schwytanie/porwanie, a dowód potwierdza zabójstwo' };
  const opposites = [['porwanie','zabojstwo'], ['obrazenia','zabojstwo'], ['pomoc','kontrola'], ['porazka','kontrola']];
  for (const [a,b] of opposites) {
    if (cConcepts.has(b) && eConcepts.has(a) && !eConcepts.has(b)) return { ok: false, reason: 'claim zawiera sprzeczne działanie względem dowodu' };
    if (cConcepts.has(a) && eConcepts.has(b) && !eConcepts.has(a)) return { ok: false, reason: 'claim zawiera sprzeczne działanie względem dowodu' };
  }
  return { ok: true };
}

function dopasowanieSemantyczne(evidence, claim) {
  const eConcepts = pojeciaCrossLanguage(evidence);
  const cConcepts = pojeciaCrossLanguage(claim);
  const sharedConcepts = [...cConcepts].filter(x => eConcepts.has(x));
  const ct = tokenyClaim(claim);
  const et = new Set(tokenyClaim(evidence));
  const overlap = ct.length ? ct.filter(t => et.has(t)).length / ct.length : 0;
  const entities = wyodrebnijNazwyWlasne(claim);
  const normalizedEvidence = normalizujClaim(evidence);
  const missingEntities = entities.filter(entity => !czyNazwaWlasnaWystepuje(entity, normalizedEvidence));
  if (missingEntities.length) return { ok: false, reason: 'dowód nie zawiera wszystkich istotnych nazw własnych claimu' };
  if (sharedConcepts.length >= 1 && entities.length >= 1) return { ok: true, mode: 'concept_and_entity', sharedConcepts, overlap };
  if (overlap >= (entities.length ? 0.34 : 0.45)) return { ok: true, mode: 'token_overlap', overlap, sharedConcepts };
  if (sharedConcepts.length >= 2) return { ok: true, mode: 'multiple_concepts', sharedConcepts, overlap };
  return { ok: false, reason: `zbyt małe pokrycie semantyczne (${overlap.toFixed(2)})` };
}

function zgodnoscStrukturalna(evidence, claim, options = {}) {
  const e = String(evidence || '');
  const c = String(claim || '');
  if (!e.trim() || !c.trim()) return { ok: false, reason: 'brak dowodu lub claimu' };
  const hard = sprawdzTwardeKonflikty(e, c, options);
  if (!hard.ok) return hard;
  const semanticConflict = sprawdzSprzecznosciSemantyczne(e, c);
  if (!semanticConflict.ok) return semanticConflict;

  const evidenceNumbers = wyodrebnijLiczbyIDaty(e);
  const claimNumbers = wyodrebnijLiczbyIDaty(c);
  if (claimNumbers.length && claimNumbers.some(n => !evidenceNumbers.includes(n))) {
    return { ok: false, reason: 'claim zawiera liczbę/datę nieobecną w dowodzie' };
  }
  const evidenceQuantities = wyodrebnijJednostkoweWartosci(e);
  const claimQuantities = wyodrebnijJednostkoweWartosci(c);
  if (claimQuantities.some(q => !evidenceQuantities.includes(q))) {
    return { ok: false, reason: 'claim zawiera wartość liczbową z niezgodną lub niepotwierdzoną jednostką' };
  }

  const claimCausal = wyodrebnijMarkery(c, CAUSAL_RE);
  const evidenceCausal = wyodrebnijMarkery(e, CAUSAL_RE);
  if (claimCausal && !evidenceCausal && !options.allowDistributedEvidence) return { ok: false, reason: 'claim dodaje relację przyczynową nieobecną w dowodzie' };

  const semantic = dopasowanieSemantyczne(e, c);
  if (semantic.ok) return semantic;
  if (options.allowCrossLanguageExactEvidence === true && (semantic.sharedConcepts?.length || 0) > 0) {
    return { ok: true, overlap: semantic.overlap ?? null, mode: 'cross_language_exact_evidence', sharedConcepts: semantic.sharedConcepts };
  }
  return semantic;
}
function tokenyPokrycia(value) {
  return [...new Set(normalizujClaim(value).split(' ').filter(t => t.length >= 3 && !COVERAGE_STOPWORDS.has(t)))];
}
function tokenyPokrywajaSie(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6) return false;
  let prefixLength = 0;
  while (prefixLength < Math.min(a.length, b.length) && a[prefixLength] === b[prefixLength]) prefixLength++;
  return prefixLength >= 5 && prefixLength / Math.min(a.length, b.length) >= 0.72;
}
function sprawdzPokrycieClaimamiOdpowiedzi(answer, claims) {
  const sentences = String(answer || '').split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  const claimRows = (Array.isArray(claims) ? claims : [])
    .map(c => ({
      tokens: tokenyPokrycia(c?.claim || ''),
      concepts: pojeciaCrossLanguage(c?.claim || ''),
      entities: wyodrebnijNazwyWlasne(c?.claim || ''),
    }))
    .filter(row => row.tokens.length >= 2 || row.concepts.size || row.entities.length);
  const uncovered = [];
  let checkedSentences = 0;
  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const tokens = tokenyPokrycia(sentence);
    if (tokens.length < 2) continue;
    checkedSentences++;
    const sentenceConcepts = pojeciaCrossLanguage(sentence);
    const sentenceEntities = wyodrebnijNazwyWlasne(sentence);
    const maxCoverage = claimRows.reduce((best, row) => {
      const covered = tokens.filter(t => row.tokens.some(c => tokenyPokrywajaSie(t, c))).length / Math.max(tokens.length, 1);
      const sharedConcepts = [...sentenceConcepts].filter(concept => row.concepts.has(concept)).length;
      const sharedEntities = sentenceEntities.filter(entity => row.entities.includes(entity)).length;
      const conceptCoverage = row.concepts.size ? sharedConcepts / row.concepts.size : 0;
      const entityCoverage = row.entities.length ? sharedEntities / row.entities.length : 0;
      return Math.max(best, covered, conceptCoverage >= 0.5 ? 0.75 : 0, entityCoverage >= 0.5 ? 0.75 : 0);
    }, 0);
    if (maxCoverage < 0.65) uncovered.push({ index: sentenceIndex, text: sentence.slice(0, 180) });
  }
  return {
    ok: uncovered.length === 0,
    totalSentences: sentences.length,
    checkedSentences,
    uncoveredSentenceIndexes: uncovered.slice(0, 8).map(item => item.index),
    uncovered: uncovered.slice(0, 4).map(item => item.text),
  };
}
function czyDowodSemantyczniePokrywaClaim(evidence, claim, options = {}) {
  return zgodnoscStrukturalna(evidence, claim, options).ok;
}
module.exports = { normalizujClaim, tokenyClaim, wyodrebnijLiczbyIDaty, wyodrebnijJednostkoweWartosci, wyodrebnijNazwyWlasne, zgodnoscStrukturalna, sprawdzTwardeKonflikty, sprawdzSprzecznosciSemantyczne, dopasowanieSemantyczne, sprawdzPokrycieClaimamiOdpowiedzi, czyDowodSemantyczniePokrywaClaim };
