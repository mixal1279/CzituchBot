'use strict';

function normalizeFactText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Dopasowanie pojedynczego słowa:
// - tokeny krótsze niż 5 znaków: tylko całe słowo (np. "nie" nie pasuje do "niezależnie"),
// - dłuższe tokeny: całe słowo albo słowo z końcówką fleksyjną do 3 znaków ("drużyn" -> "drużyny").
function tokenMatchesWord(token, word) {
  if (token === word) return true;
  if (token.length < 5) return false;
  return word.startsWith(token) && word.length - token.length <= 3;
}

// Fraza musi wystąpić w odpowiedzi jako ciągła sekwencja słów, w tej samej kolejności.
function phraseMatches(phrase, words) {
  const tokens = normalizeFactText(phrase).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  for (let i = 0; i + tokens.length <= words.length; i++) {
    if (tokens.every((token, j) => tokenMatchesWord(token, words[i + j]))) return true;
  }
  return false;
}

function scoreGoldenFacts(answer, factual) {
  if (!factual?.independentGold) return { applicable: false, score: null, passed: null, missing: [], forbidden: [] };
  const words = normalizeFactText(answer).split(' ').filter(Boolean);
  const missing = [];
  for (const group of factual.mustInclude || []) {
    const ok = group.every(phrase => phraseMatches(phrase, words));
    if (!ok) missing.push(group);
  }
  const forbidden = (factual.mustNot || []).filter(phrase => phraseMatches(phrase, words));
  const total = (factual.mustInclude || []).length;
  const score = total ? (total - missing.length) / total : 1;
  return { applicable: true, score, passed: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

// Kontekst gry dopisywany naturalnym językiem ("w grze X"), bez nawiasów: nawiasy w pytaniu
// trafiały do zapytań Tavily jako osobne, bezsensowne query (np. "(gra: Skyrim)").
function withGameContext(question, game) {
  const q = String(question || '').trim();
  if (!game) return q;
  if (q.toLowerCase().includes(String(game).toLowerCase())) return q;
  if (/\bw tej grze\b/i.test(q)) return q.replace(/\bw tej grze\b/i, `w grze ${game}`);
  return `${q.replace(/\s*\?\s*$/, '')} w grze ${game}?`;
}

module.exports = { normalizeFactText, tokenMatchesWord, phraseMatches, scoreGoldenFacts, withGameContext };
