'use strict';

function normalizeFactText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Polska fleksja: „pomóc”/„pomógł”, „Baron”/„Baronowi”. Słowa od 5 znaków
// porównujemy po rdzeniu (bez maks. 3 ostatnich liter), krótsze dokładnie.
function wordMatches(textWord, phraseWord) {
  if (textWord === phraseWord) return true;
  if (phraseWord.length < 5) return false;
  const stem = phraseWord.slice(0, Math.max(4, phraseWord.length - 2));
  // Po rdzeniu może zostać tylko krótka końcówka fleksyjna (do 4 znaków), dzięki
  // czemu „kontrolowanie” nie pasuje do „kontrolę”.
  return textWord.startsWith(stem) && textWord.length - stem.length <= 4;
}

function phraseMatches(text, phrase) {
  const normalizedPhrase = normalizeFactText(phrase);
  if (!normalizedPhrase) return false;
  if (` ${text} `.includes(` ${normalizedPhrase} `)) return true;
  const phraseWords = normalizedPhrase.split(' ');
  const textWords = text.split(' ');
  for (let i = 0; i + phraseWords.length <= textWords.length; i++) {
    if (phraseWords.every((word, offset) => wordMatches(textWords[i + offset], word))) return true;
  }
  return false;
}

function scoreGoldenFacts(answer, factual) {
  if (!factual?.independentGold) {
    return { applicable: false, score: null, passed: null, missing: [], forbidden: [], requiredFacts: 0, passedFacts: 0, factAccuracy: null };
  }
  const text = normalizeFactText(answer);
  const missing = [];
  for (const group of factual.mustInclude || []) {
    if (!group.every(phrase => phraseMatches(text, phrase))) missing.push(group);
  }
  // Każda grupa mustIncludeAny to osobny fakt z równoważnymi, ręcznie dobranymi wariantami.
  for (const group of factual.mustIncludeAny || []) {
    if (!group.some(phrase => phraseMatches(text, phrase))) missing.push(group);
  }
  const forbidden = (factual.mustNot || []).filter(phrase => phraseMatches(text, phrase));
  const includedTotal = (factual.mustInclude || []).length + (factual.mustIncludeAny || []).length;
  const forbiddenTotal = (factual.mustNot || []).length;
  const requiredFacts = includedTotal + forbiddenTotal;
  if (!requiredFacts) {
    return { applicable: true, score: 0, passed: false, missing: [], forbidden: [], requiredFacts: 0, passedFacts: 0, factAccuracy: 0, invalidContract: true };
  }
  const passedFacts = (includedTotal - missing.length) + (forbiddenTotal - forbidden.length);
  const factAccuracy = passedFacts / requiredFacts;
  return {
    applicable: true, score: factAccuracy,
    passed: missing.length === 0 && forbidden.length === 0,
    missing, forbidden, requiredFacts, passedFacts, factAccuracy,
  };
}

module.exports = { normalizeFactText, scoreGoldenFacts };
