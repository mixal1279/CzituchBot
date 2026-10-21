'use strict';

const { parseEvidenceBlocks } = require('./evidence');

const {
  buildRetrievalPlan,
  assessEvidence,
  decideEvidencePolicy,
  normalize,
} = require('./core');

const STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  SOFT_ACCEPTED: 'soft_accepted',
  INCONCLUSIVE: 'inconclusive',
  UNAVAILABLE: 'unavailable',
  UNVERIFIED: 'unverified',
});

function createRequestId(randomUUID = null) {
  if (typeof randomUUID === 'function') return String(randomUUID()).slice(0, 12);
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeQuestion(question, sanitizeFn, maxLength = 500) {
  // Sanityzator przycina tekst do limitu, więc dajemy mu zapas (+2): inaczej `> maxLength` nigdy
  // się nie spełnia, a zbyt długie pytanie jest po cichu ucinane zamiast odrzucone jako too_long.
  const value = String(typeof sanitizeFn === 'function' ? sanitizeFn(question, maxLength + 2) : question || '').trim();
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
  // Keep evidence parsing and metadata removal identical in the validator and
  // evidence-policy path. A second parser here previously let page titles/URLs
  // influence evidence scoring even when the validator correctly stripped them.
  return parseEvidenceBlocks(text).map(block => ({
    ...block,
    title: block.title || block.sourceId,
  }));
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

function classifyPipelineFailure(status, options = {}) {
  const s = String(status || '').toLowerCase();
  if (s === 'accepted') return null;
  if (s === 'soft_accepted') return 'validator_reject';
  if (s === 'rejected') return 'validator_reject';
  if (s === 'inconclusive') return 'validator_inconclusive';
  if (s === 'unavailable') return options.reason || 'provider_unavailable';
  if (s === 'unverified') return 'validator_unverified';
  return 'unknown';
}

function decideValidation(status, options = {}) {
  const s = String(status || '').toLowerCase();
  if (s === STATUS.ACCEPTED) return { finalStatus: STATUS.ACCEPTED, retry: false };
  if (s === STATUS.SOFT_ACCEPTED) {
    // Odpowiedź częściowa jest już zweryfikowana lokalnie: walidator buduje ją
    // wyłącznie z claimów, których cytat przeszedł kontrolę dowodową (partialAnswer).
    // Nie wolno jej zamieniać na odmowę — zamiana niszczyła poprawne odpowiedzi.
    return {
      finalStatus: STATUS.SOFT_ACCEPTED,
      retry: false,
      reason: 'partial_answer_delivered',
    };
  }
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
  if (s === STATUS.UNVERIFIED) {
    return { finalStatus: STATUS.UNVERIFIED, retry: false, reason: 'validator_unavailable_but_deterministic_gates_passed' };
  }
  return { finalStatus: STATUS.UNAVAILABLE, retry: false, reason: 'validator_unavailable' };
}

function finalText(text, status, helpers = {}) {
  if (status === STATUS.REJECTED) return helpers.rejectedMessage || 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.';
  if (status === STATUS.SOFT_ACCEPTED) {
    // NIE ufamy tekstowi przekazanyemu z zewnątrz. Jedynym źródłem prawdy jest
    // partialAnswer zbudowany przez walidator wyłącznie z claimów, których cytat
    // przeszedł kontrolę dowodową; jest zakończony zastrzeżeniem „Nie wszystkie
    // szczegóły da się potwierdzić…". To odpowiedź zweryfikowana częściowo —
    // nie odrzucona (tę nadal zastępuje odmowa powyżej).
    //
    // Gdy caller nie poda partialAnswer, publikujemy odmowę: brak partialAnswer
    // nigdy nie może oznaczać „wypuść pełną, niezweryfikowaną odpowiedź”.
    let value = String(helpers.partialAnswer || '');
    if (typeof helpers.sanitizeResponse === 'function') value = helpers.sanitizeResponse(value);
    value = value.trim();
    return value || (helpers.rejectedMessage || 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.');
  }
  if (status === STATUS.INCONCLUSIVE) return helpers.inconclusiveMessage || 'Chwilowo nie mogę wiarygodnie potwierdzić tej informacji, więc nie będę zgadywać.';
  if (status === STATUS.UNAVAILABLE) return helpers.unavailableMessage || 'Chwilowo nie mogę potwierdzić tej informacji, więc nie będę zgadywać.';
  if (status === STATUS.UNVERIFIED) {
    let value = String(text || '');
    if (typeof helpers.sanitizeResponse === 'function') value = helpers.sanitizeResponse(value);
    value = value.trim();
    const warning = '⚠️ Odpowiedź niezweryfikowana — walidator jest niedostępny. ';
    return value
      ? (value.startsWith(warning) ? value : warning + value)
      : (helpers.unavailableMessage || 'Chwilowo nie mogę potwierdzić tej informacji, więc nie będę zgadywać.');
  }

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
  classifyPipelineFailure,
  finalText,
  parseEvidenceText,
};
