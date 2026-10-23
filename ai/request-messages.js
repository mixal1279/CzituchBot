'use strict';

function isMissingQuestionPlaceholder(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/ł/g, 'l')
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
  return /^(?:nie (?:otrzymalem|otrzymalam|dostalem|dostalam|widze) pytania|nie dostarczono pytania|brak pytania|i (?:did not receive|didn t receive|have not received|haven t received) (?:(?:a|the) )?question|no question (?:was )?(?:provided|received)|you (?:have not|haven t) (?:provided|asked) (?:a )?question)$/.test(normalized);
}

// Provider-independent request message contract. History preparation and
// evidence bounding remain injected so this module has no bot/provider side effects.
function buildRequestMessages({
  systemPrompt,
  history,
  context,
  question,
  prepareHistory,
  buildBoundedEvidencePrompt,
  historyLimit = 4,
  referenceLimit = 10000,
} = {}) {
  const originalQuestion = String(question || '');
  const sourceContext = String(context || originalQuestion);
  const preparedHistory = typeof prepareHistory === 'function'
    ? prepareHistory(history, historyLimit)
    : [];
  const boundedUser = typeof buildBoundedEvidencePrompt === 'function'
    ? buildBoundedEvidencePrompt(sourceContext, originalQuestion, referenceLimit)
    : sourceContext;

  return {
    system: String(systemPrompt || ''),
    history: Array.isArray(preparedHistory) ? preparedHistory : [],
    user: String(boundedUser || ''),
  };
}

function buildOpenRouterMessages(messages = {}) {
  return [
    { role: 'system', content: String(messages.system || '') },
    ...(Array.isArray(messages.history) ? messages.history : []),
    { role: 'user', content: String(messages.user || '') },
  ];
}

module.exports = { buildRequestMessages, buildOpenRouterMessages, isMissingQuestionPlaceholder };
