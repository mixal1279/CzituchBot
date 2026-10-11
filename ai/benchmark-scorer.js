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

function scoreGoldenFacts(answer, factual) {
  if (!factual?.independentGold) return { applicable: false, score: null, passed: null, missing: [], forbidden: [] };
  const text = normalizeFactText(answer);
  const missing = [];
  for (const group of factual.mustInclude || []) {
    const ok = group.every(phrase => {
      const normalizedPhrase = normalizeFactText(phrase);
      return normalizedPhrase.length > 0 && ` ${text} `.includes(` ${normalizedPhrase} `);
    });
    if (!ok) missing.push(group);
  }
  const forbidden = (factual.mustNot || []).filter(phrase => {
    const normalizedPhrase = normalizeFactText(phrase);
    return normalizedPhrase.length > 0 && ` ${text} `.includes(` ${normalizedPhrase} `);
  });
  const total = (factual.mustInclude || []).length;
  const score = total ? (total - missing.length) / total : 1;
  return { applicable: true, score, passed: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

module.exports = { normalizeFactText, scoreGoldenFacts };
