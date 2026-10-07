'use strict';

const {
  buildRetrievalPlan,
  assessEvidence,
  decideEvidencePolicy,
  normalize,
} = require('./core');

const STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  INCONCLUSIVE: 'inconclusive',
  UNAVAILABLE: 'unavailable',
});

function createRequestId(randomUUID = null) {
  if (typeof randomUUID === 'function') return String(randomUUID()).slice(0, 12);
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeQuestion(question, sanitizeFn, maxLength = 500) {
  const value = String(typeof sanitizeFn === 'function' ? sanitizeFn(question) : question || '').trim();
  if (!value) return { ok: false, reason: 'empty' };
  if (value.length > maxLength) return { ok: false, reason: 'too_long', maxLength };
  return { ok: true, value };
}

function planRequest(question, routing, plannerFn, retrievalFn) {
  const plan = typeof plannerFn === 'function'
    ? plannerFn(question, routing)
    : { responseProfile: 'simple', sourcePolicy: 'default' };

  const base = typeof retrievalFn === 'function'
    ? retrievalFn(question, routing, { maxQueries: 3 })
    : [];

  const advanced = buildRetrievalPlan(question, routing, { maxQueries: 5 });
  const seen = new Set();
  const retrievalPlan = [...advanced, ...(Array.isArray(base) ? base.map(query => ({ query, priority: 'fallback', reason: 'legacy' })) : [])]
    .filter(item => {
      const key = normalize(item?.query);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);

  return { plan, retrievalPlan };
}

function parseEvidenceText(text) {
  const value = String(text || '');
  const re = /^\[(SOURCE \d+|REFERENCE [^\]\r\n]+)\]\s*$/gmi;
  const matches = [...value.matchAll(re)];
  return matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : value.length;
    const block = value.slice(start, end);
    return {
      sourceId: m[1].trim(),
      title: block.match(/TYTUŁ:\\s*([^\\r\\n]+)/i)?.[1] || m[1],
      url: block.match(/URL:\\s*(https?:\\/\\/[^\\s\\r\\n]+)/i)?.[1] || '',
      content: block,
    };
  });
}

function evaluateEvidence(question, routing, sources) {
  const normalizedSources = typeof sources === 'string' ? parseEvidenceText(sources) : sources;
  const evidence = assessEvidence(normalizedSources, question, routing);
  const policy = decideEvidencePolicy(evidence, routing);
  return { evidence, policy };
}

function shouldValidate({ routing = {}, evidencePolicy = {}, hasExternalData = false, searched = false }) {
  if (evidencePolicy.requireValidator) return true;
  if (hasExternalData && (routing.needs_fresh_data || routing.is_lore || routing.is_gameplay)) return true;
  return Boolean(searched && routing.needs_web);
}

function decideValidation(status, options = {}) {
  const s = String(status || '').toLowerCase();
  if (s === STATUS.ACCEPTED) return { finalStatus: STATUS.ACCEPTED, retry: false };
  if (s === STATUS.REJECTED) {
    return {
      finalStatus: STATUS.REJECTED,
      retry: Boolean(options.allowRetry),
      reason: 'unsupported_or_unverified_claims',
    };
  }
  if (s === STATUS.INCONCLUSIVE) {
    return {
      finalStatus: STATUS.INCONCLUSIVE,
      retry: Boolean(options.allowRetry && options.hasNewEvidence),
      reason: 'validator_could_not_reach_a_reliable_decision',
    };
  }
  return { finalStatus: STATUS.UNAVAILABLE, retry: false, reason: 'validator_unavailable' };
}

function finalText(text, status, helpers = {}) {
  if (status === STATUS.REJECTED) return helpers.rejectedMessage || 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.';
  if (status === STATUS.INCONCLUSIVE) return helpers.inconclusiveMessage || 'Chwilowo nie mogę wiarygodnie potwierdzić tej informacji, więc nie będę zgadywać.';
  if (status === STATUS.UNAVAILABLE) return helpers.unavailableMessage || 'Chwilowo nie mogę potwierdzić tej informacji, więc nie będę zgadywać.';

  let value = String(text || '');
  if (typeof helpers.sanitizeResponse === 'function') value = helpers.sanitizeResponse(value);
  return value.trim();
}

module.exports = {
  STATUS,
  createRequestId,
  sanitizeQuestion,
  planRequest,
  evaluateEvidence,
  shouldValidate,
  decideValidation,
  finalText,
  parseEvidenceText,
};
