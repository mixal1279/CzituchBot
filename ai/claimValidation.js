'use strict';

const NEGATION_RE = /\b(?:nie|nigdy|brak|bez|żaden|żadna|żadne|never|no|not)\b/iu;
const CAUSAL_RE = /\b(?:bo|ponieważ|gdyż|dlatego|z\s+powodu|w\s+celu|żeby|aby|chciał(?:a|o)?|chcia(?:ł|ła|li)|celem|because|therefore|due\s+to)\b/iu;
const TEMPORAL_RE = /\b(?:19|20)\d{2}\b|\b(?:styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień|wrzesień|październik|listopad|grudzień)\b|\b(?:wczoraj|dzisiaj|jutro|today|yesterday|tomorrow)\b/iu;
const CROSS_LANGUAGE_CONCEPTS = [
  ['porwanie', /kidnap\w*|abduct\w*|porwan\w*|uprowadz\w*/i],
  ['obrazenia', /injur\w*|wound\w*|hurt\w*|rann\w*|obraż\w*/i],
  ['zabojstwo', /kill\w*|murder\w*|death|dead|zabij\w*|zgin\w*|śmier\w*/i],
  ['konflikt', /conflict\w*|feud\w*|fight\w*|war\w*|konflikt\w*|walcz\w*|wojn\w*/i],
  ['zwiazek', /relationship\w*|girlfriend\w*|boyfriend\w*|partner\w*|romanc\w*|zwi[aą]zk\w*|relacj\w*|dziewczyn\w*|chłopak\w*|partner\w*/i],
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
function zgodnoscStrukturalna(evidence, claim, options = {}) {
  const e = String(evidence || '');
  const c = String(claim || '');
  if (!e.trim() || !c.trim()) return { ok: false, reason: 'brak dowodu lub claimu' };

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
  const threshold = claimEntities.length && claimEntities.every(entity => evidenceNormalized.includes(entity))
    ? 0.50
    : (ct.length <= 5 ? 0.67 : 0.60);
  if (overlap < threshold) return { ok: false, reason: `zbyt małe pokrycie semantyczne (${overlap.toFixed(2)} < ${threshold.toFixed(2)})` };
  return { ok: true, overlap };
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
  const claimTexts = (Array.isArray(claims) ? claims : []).map(c => tokenyPokrycia(c?.claim || '')).filter(t => t.length >= 2);
  const uncovered = [];
  let checkedSentences = 0;
  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const tokens = tokenyPokrycia(sentence);
    if (tokens.length < 2) continue;
    checkedSentences++;
    const maxCoverage = claimTexts.reduce((best, claimTokens) => {
      const covered = tokens.filter(t => claimTokens.some(c => tokenyPokrywajaSie(t, c))).length / tokens.length;
      return Math.max(best, covered);
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
function czyDowodSemantyczniePokrywaClaim(evidence, claim) {
  return zgodnoscStrukturalna(evidence, claim).ok;
}
module.exports = { normalizujClaim, tokenyClaim, wyodrebnijLiczbyIDaty, wyodrebnijJednostkoweWartosci, wyodrebnijNazwyWlasne, zgodnoscStrukturalna, sprawdzPokrycieClaimamiOdpowiedzi, czyDowodSemantyczniePokrywaClaim };
