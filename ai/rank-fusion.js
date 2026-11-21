'use strict';

/**
 * Reciprocal Rank Fusion — łączy rankingi o różnych skalach punktowych.
 * Identyfikatory powinny być stabilne w obrębie jednego żądania (np. canonical URL).
 */
function reciprocalRankFusion(rankings, options = {}) {
  const input = Array.isArray(rankings) ? rankings : [];
  const rawK = Number(options.k);
  const k = Number.isFinite(rawK) ? Math.max(1, Math.min(200, Math.floor(rawK))) : 60;
  const weights = Array.isArray(options.weights) ? options.weights : [];
  const scores = new Map();
  const firstSeen = new Map();
  let sequence = 0;

  for (let index = 0; index < input.length; index++) {
    const ranking = Array.isArray(input[index]) ? input[index] : [];
    const rawWeight = Number(weights[index]);
    const weight = Number.isFinite(rawWeight) ? Math.max(0, Math.min(5, rawWeight)) : 1;
    const seen = new Set();
    let rank = 0;
    for (const rawId of ranking) {
      const id = String(rawId ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rank++;
      if (!firstSeen.has(id)) firstSeen.set(id, sequence++);
      scores.set(id, (scores.get(id) || 0) + weight / (k + rank));
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score
      || firstSeen.get(a.id) - firstSeen.get(b.id)
      || a.id.localeCompare(b.id));
}

module.exports = { reciprocalRankFusion };
