'use strict';

// Naprawa KSZTAŁTU odpowiedzi walidatora, nie jej treści.
// Modele (gpt-oss przez Groq/OpenRouter) zwracają czasem poprawną semantycznie
// odpowiedź w lekko złej strukturze, co dawało SCHEMA_REJECT i wyrzucało całego
// walidatora. Naprawiamy wyłącznie jednoznaczne przypadki i niczego nie
// uzupełniamy: brakujące pola nadal kończą się odrzuceniem. Wynik i tak przechodzi
// pełną lokalną weryfikację (źródło, cytat, negacje, liczby, pokrycie odpowiedzi).

// Słowne poziomy pewności. Tylko "high" przekracza próg akceptacji (0.75).
const CONFIDENCE_WORDS = Object.freeze({ high: 0.9, medium: 0.6, low: 0.3 });

function czyObiekt(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function czyElementClaimu(value) {
  return czyObiekt(value) && typeof value.claim === 'string';
}

// {"": {claim...}} albo {"claim": {claim...}} -> {claim...}
// (jedyny klucz opakowuje właściwy obiekt claimu)
function rozpakujClaim(element) {
  if (!czyObiekt(element) || czyElementClaimu(element)) return element;
  const keys = Object.keys(element);
  if (keys.length !== 1) return element;
  const inner = element[keys[0]];
  return czyElementClaimu(inner) ? inner : element;
}

function parsujConfidence(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (Object.hasOwn(CONFIDENCE_WORDS, raw)) return CONFIDENCE_WORDS[raw];
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(%?)$/);
  if (!match) return null;
  let number = Number(match[1]);
  if (match[2] || number > 1) number /= 100;
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

/**
 * @returns {{ wynik: any, poprawki: string[] }} wynik to kopia z naprawionym
 * kształtem (oryginał nie jest mutowany); poprawki to lista zastosowanych napraw.
 */
function naprawKsztaltWynikuWalidatora(wynik) {
  if (!czyObiekt(wynik)) return { wynik, poprawki: [] };
  const naprawiony = { ...wynik };
  const poprawki = [];

  // Claims wpisane w pole `supported` (zamiast booleana zbiorczego + `claims`).
  const brakClaims = !Array.isArray(naprawiony.claims) && !Array.isArray(naprawiony.claims_list);
  if (
    brakClaims
    && Array.isArray(naprawiony.supported)
    && naprawiony.supported.length > 0
    && naprawiony.supported.every(element => czyElementClaimu(rozpakujClaim(element)))
  ) {
    naprawiony.claims = naprawiony.supported;
    // `supported` ma być booleanem zbiorczym: prawda tylko, gdy KAŻDY claim jest wspierany.
    naprawiony.supported = naprawiony.supported.every(element => rozpakujClaim(element).supported === true);
    poprawki.push('supported_array_as_claims');
  }

  for (const key of ['claims', 'claims_list']) {
    if (!Array.isArray(naprawiony[key])) continue;
    const rozpakowane = naprawiony[key].map(rozpakujClaim);
    if (rozpakowane.some((element, index) => element !== naprawiony[key][index])) {
      naprawiony[key] = rozpakowane;
      poprawki.push('claim_wrapper_unwrapped');
    }
  }

  if (typeof naprawiony.confidence === 'string') {
    const confidence = parsujConfidence(naprawiony.confidence);
    if (confidence !== null) {
      naprawiony.confidence = confidence;
      poprawki.push('confidence_text_to_number');
    }
  }

  return { wynik: poprawki.length ? naprawiony : wynik, poprawki };
}

module.exports = { naprawKsztaltWynikuWalidatora, CONFIDENCE_WORDS };
