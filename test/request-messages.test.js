'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequestMessages, buildOpenRouterMessages, isMissingQuestionPlaceholder } = require('../ai/request-messages');

test('shared request contract preserves the original question and bounded evidence context', () => {
  const history = [{ role: 'user', content: 'previous question' }];
  const preparedHistory = [{ role: 'assistant', content: 'history summary' }];
  let historyLimitSeen = null;
  let promptArgs = null;
  const messages = buildRequestMessages({
    systemPrompt: 'system rules',
    history,
    context: 'retrieved evidence',
    question: 'original user question',
    prepareHistory(value, limit) {
      assert.equal(value, history);
      historyLimitSeen = limit;
      return preparedHistory;
    },
    buildBoundedEvidencePrompt(context, question, limit) {
      promptArgs = { context, question, limit };
      return 'bounded prompt';
    },
  });

  assert.deepEqual(messages, {
    system: 'system rules',
    history: preparedHistory,
    user: 'bounded prompt',
  });
  assert.equal(historyLimitSeen, 4);
  assert.deepEqual(promptArgs, {
    context: 'retrieved evidence',
    question: 'original user question',
    limit: 10000,
  });
});

test('shared request contract falls back to the original question when context is empty', () => {
  const messages = buildRequestMessages({
    question: 'original user question',
    context: '',
    prepareHistory: () => [],
    buildBoundedEvidencePrompt: (context, question) => `${context} | ${question}`,
  });
  assert.equal(messages.user, 'original user question | original user question');
});

test('OpenRouter formatting uses the same system, history and user contract as other providers', () => {
  const messages = buildOpenRouterMessages({
    system: 'system rules',
    history: [
      { role: 'user', content: 'question 1' },
      { role: 'assistant', content: 'answer 1' },
    ],
    user: 'current question with evidence',
  });
  assert.deepEqual(messages, [
    { role: 'system', content: 'system rules' },
    { role: 'user', content: 'question 1' },
    { role: 'assistant', content: 'answer 1' },
    { role: 'user', content: 'current question with evidence' },
  ]);
});


test('missing-question placeholder is classified as empty output, not a successful generation', () => {
  for (const value of [
    'Nie otrzymałem pytania.',
    'Nie otrzymałam pytania!',
    'Nie dostałem pytania',
    'I did not receive a question.',
    "I didn't receive the question.",
    'No question was provided.',
  ]) {
    assert.equal(isMissingQuestionPlaceholder(value), true, value);
  }
  assert.equal(isMissingQuestionPlaceholder('Wheatley nie otrzymał pytania od Chell, a potem przejął kontrolę.'), false);
  assert.equal(isMissingQuestionPlaceholder('Nie otrzymałem pytania, ale mogę wyjaśnić kontekst fabuły.'), false);
  assert.equal(isMissingQuestionPlaceholder('Wheatley przejął kontrolę nad Aperture.'), false);
});
