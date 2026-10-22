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

  // A score threshold is a lower bound, not permission to omit a required slot.
  // Every requirement produced by buildAnswerPlan is mandatory; a 3/4 answer
  // must not be reported as complete merely because 0.75 meets the high threshold.
  if (completeness.missing.length > 0 || completeness.score < minScore) {
    const reason = completeness.missing.length > 0
      ? 'odpowiedź nie pokrywa wymaganych elementów pytania: ' + completeness.missing.join(', ')
      : 'wynik kompletności odpowiedzi jest poniżej wymaganego progu';
    return {
      status: 'repair', ok: false, score: completeness.score,
      missing: completeness.missing,
      reason,
      repairable: true,
    };
  }

  return {
    status: 'accepted', ok: true, score: completeness.score,
    missing: [], reason: 'odpowiedź pokrywa wymagane elementy pytania', repairable: false,
  };
}


function partialAnswerPreservesCoreIntent(judgement) {
  if (!judgement || judgement.status === 'rejected') return false;
  const missing = Array.isArray(judgement.missing) ? judgement.missing : [];
  // Context/game-name metadata may be omitted in a partial answer; the question's
  // primary intent (why/how/where/when/who, required steps, causal links, clauses)
  // may not be omitted just because some other claims were verified.
  return missing.every(requirement => requirement === 'entity_context');
}

module.exports = { judgeAnswer, partialAnswerPreservesCoreIntent };
