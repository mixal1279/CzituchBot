'use strict';

const DEFAULT_MAX_PROMPT_CHARS = 10000;
function buildBoundedEvidencePrompt(context, question, maxChars = DEFAULT_MAX_PROMPT_CHARS) {
  const limit = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : DEFAULT_MAX_PROMPT_CHARS;
  const source = String(context ?? '').trim();
  const asked = String(question ?? '').trim();
  if (!source) return asked.slice(0, limit);
  const marker = 'Pytanie użytkownika:';
  const markerIndex = source.lastIndexOf(marker);
  const hasEmbeddedQuestion = markerIndex >= 0;
  // The explicit request argument is authoritative. Embedded context can be stale or
  // contain a rewritten retrieval query; it must never replace the user's original question.
  const questionText = (asked || (hasEmbeddedQuestion ? source.slice(markerIndex + marker.length).trim() : source)).trim();
  const prefix = hasEmbeddedQuestion ? source.slice(0, markerIndex).trimEnd() : (source === asked ? '' : source);
  const suffix = prefix ? '\n---\n' + marker + ' ' + questionText : questionText;
  if (suffix.length >= limit) return (prefix ? marker + ' ' + questionText : questionText).slice(-limit);
  return prefix.slice(0, Math.max(0, limit - suffix.length)).trimEnd() + suffix;
}
module.exports = { DEFAULT_MAX_PROMPT_CHARS, buildBoundedEvidencePrompt };
