'use strict';

const { assessAnswerCompleteness } = require('./answer-plan');

function judgeAnswer(answer, plan, options = {}) {
  const completeness = assessAnswerCompleteness(answer, plan);
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : (plan?.complexity === 'high' ? 0.75 : 0.67);

  if (!String(answer || '').trim()) {
    return {
      status: 'rejected', ok: false, score: 0,
      missing: completeness.missing,
      reason: 'pusta odpowiedź', repairable: false,
    };
  }

  if (completeness.score < minScore) {
    return {
      status: 'repair', ok: false, score: completeness.score,
      missing: completeness.missing,
      reason: 'odpowiedź nie pokrywa wymaganych elementów pytania: ' + completeness.missing.join(', '),
      repairable: true,
    };
  }

  return {
    status: 'accepted', ok: true, score: completeness.score,
    missing: [], reason: 'odpowiedź pokrywa wymagane elementy pytania', repairable: false,
  };
}

module.exports = { judgeAnswer };
