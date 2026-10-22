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
  if (!factual?.independentGold) return { applicable: false, score: null, passed: null, missing: [], forbidden: [] };
  const text = normalizeFactText(answer);
  const missing = [];
  for (const group of factual.mustInclude || []) {
    const ok = group.every(phrase => phraseMatches(text, phrase));
    if (!ok) missing.push(group);
  }
  // Some facts have several equally valid source-grounded descriptions (e.g.
  // two nearby landmarks or inflected forms of the same item). Each group in
  // mustIncludeAny is one requirement; any phrase in that group satisfies it.
  for (const group of factual.mustIncludeAny || []) {
    const ok = group.some(phrase => phraseMatches(text, phrase));
    if (!ok) missing.push(group);
  }
  const forbidden = (factual.mustNot || []).filter(phrase => phraseMatches(text, phrase));
  const includedTotal = (factual.mustInclude || []).length + (factual.mustIncludeAny || []).length;
  const forbiddenTotal = (factual.mustNot || []).length;
  const total = includedTotal + forbiddenTotal;
  const score = total
    ? ((includedTotal - missing.length) + (forbiddenTotal - forbidden.length)) / total
    : 1;
  return { applicable: true, score, passed: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

module.exports = { normalizeFactText, scoreGoldenFacts };
