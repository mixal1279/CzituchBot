'use strict';

function normalizeFactText(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsNormalizedPhrase(text, phrase) {
  const normalizedText = normalizeFactText(text);
  const normalizedPhrase = normalizeFactText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  return (' ' + normalizedText + ' ').includes(' ' + normalizedPhrase + ' ');
}

function scoreGoldenFacts(answer, factual) {
  if (!factual?.independentGold) {
    return { applicable: false, score: null, passed: null, missing: [], forbidden: [] };
  }

  const answerTokens = new Set(normalizeFactText(answer).split(' ').filter(Boolean));
  const missing = [];
  for (const group of factual.mustInclude || []) {
    const requiredTokens = (Array.isArray(group) ? group : [group])
      .flatMap(phrase => normalizeFactText(phrase).split(' '))
      .filter(Boolean);
    if (requiredTokens.some(token => !answerTokens.has(token))) missing.push(group);
  }

  const forbidden = (factual.mustNot || [])
    .filter(phrase => containsNormalizedPhrase(answer, phrase));
  const total = (factual.mustInclude || []).length;
  const score = total ? (total - missing.length) / total : 1;
  return {
    applicable: true,
    score,
    passed: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
  };
}

module.exports = { normalizeFactText, containsNormalizedPhrase, scoreGoldenFacts };
