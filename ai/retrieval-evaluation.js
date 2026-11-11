'use strict';

function bezpieczneK(value, fallback = 5) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.floor(parsed))) : fallback;
}

function unikalneIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value ?? '').trim()).filter(Boolean))];
}

function precisionAtK(rankedIds, relevantIds, k = 5) {
  const limit = bezpieczneK(k);
  const ranked = unikalneIds(rankedIds).slice(0, limit);
  const relevant = new Set(unikalneIds(relevantIds));
  return ranked.filter(id => relevant.has(id)).length / limit;
}

function recallAtK(rankedIds, relevantIds, k = 5) {
  const ranked = unikalneIds(rankedIds).slice(0, bezpieczneK(k));
  const relevant = new Set(unikalneIds(relevantIds));
  if (!relevant.size) return null;
  return ranked.filter(id => relevant.has(id)).length / relevant.size;
}

function reciprocalRank(rankedIds, relevantIds) {
  const ranked = unikalneIds(rankedIds);
  const relevant = new Set(unikalneIds(relevantIds));
  const index = ranked.findIndex(id => relevant.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

function dcgAtK(rankedIds, relevanceById, k) {
  const ranked = unikalneIds(rankedIds).slice(0, bezpieczneK(k));
  return ranked.reduce((sum, id, index) => {
    const raw = Number(relevanceById?.[id]);
    const relevance = Number.isFinite(raw) ? Math.max(0, Math.min(3, raw)) : 0;
    return sum + ((2 ** relevance) - 1) / Math.log2(index + 2);
  }, 0);
}

function ndcgAtK(rankedIds, relevanceById, k = 5) {
  const limit = bezpieczneK(k);
  if (!relevanceById || typeof relevanceById !== 'object' || Array.isArray(relevanceById)) return null;
  const ideal = Object.entries(relevanceById)
    .map(([id, value]) => ({ id, value: Number(value) }))
    .filter(item => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value)
    .map(item => item.id);
  const idealDcg = dcgAtK(ideal, relevanceById, limit);
  return idealDcg > 0 ? dcgAtK(rankedIds, relevanceById, limit) / idealDcg : null;
}

function evaluateRetrieval(rankedIds, relevantIds, options = {}) {
  const k = bezpieczneK(options.k);
  const ranked = unikalneIds(rankedIds);
  const relevant = unikalneIds(relevantIds);
  const relevanceById = options.relevanceById || Object.fromEntries(relevant.map(id => [id, 1]));
  return {
    k, candidateCount: ranked.length, relevantCount: relevant.length,
    precisionAtK: Number(precisionAtK(ranked, relevant, k).toFixed(4)),
    recallAtK: recallAtK(ranked, relevant, k),
    reciprocalRank: Number(reciprocalRank(ranked, relevant).toFixed(4)),
    ndcgAtK: ndcgAtK(ranked, relevanceById, k),
  };
}

function aggregateRetrievalMetrics(rows) {
  const values = Array.isArray(rows) ? rows : [];
  const keys = ['precisionAtK', 'recallAtK', 'reciprocalRank', 'ndcgAtK'];
  const result = { cases: values.length };
  for (const key of keys) {
    const usable = values.map(row => row?.[key]).filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
    result[key] = usable.length
      ? Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(4))
      : null;
    result[key + 'Cases'] = usable.length;
  }
  return result;
}

module.exports = {
  precisionAtK, recallAtK, reciprocalRank, ndcgAtK,
  evaluateRetrieval, aggregateRetrievalMetrics,
};
