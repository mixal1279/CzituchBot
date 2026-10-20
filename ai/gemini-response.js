'use strict';

const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY', 'RECITATION', 'LANGUAGE', 'BLOCKLIST',
  'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'CONTINUATION',
]);

function normalizeSafetyRatings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(rating => rating && typeof rating === 'object')
    .map(rating => ({
      category: typeof rating.category === 'string' ? rating.category : '',
      blocked: rating.blocked === true,
      probability: typeof rating.probability === 'string' ? rating.probability : '',
    }))
    .filter(rating => rating.category || rating.blocked || rating.probability);
}

function summarizeSafetyRatings(ratings) {
  return ratings
    .filter(rating => rating.blocked || rating.category)
    .map(rating => rating.category
      + (rating.blocked ? ' (blocked)' : '')
      + (rating.probability ? ` probability=${rating.probability}` : ''))
    .join(', ');
}

/**
 * Normalize a Gemini GenerateContent response for text generation while
 * retaining documented prompt/candidate blocking and truncation metadata.
 */
function parseGeminiGenerationResponse(data, label = 'Gemini') {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  if (candidates.length === 0) {
    const feedback = data?.promptFeedback && typeof data.promptFeedback === 'object'
      ? data.promptFeedback
      : {};
    const blockReason = typeof feedback.blockReason === 'string' ? feedback.blockReason.trim() : '';
    const safetyRatings = normalizeSafetyRatings(feedback.safetyRatings);
    const safetySummary = summarizeSafetyRatings(safetyRatings);
    const reason = blockReason
      ? `${label}: brak kandydatów; promptFeedback.blockReason=${blockReason}${safetySummary ? `; safetyRatings: ${safetySummary}` : ''}`
      : `${label}: brak kandydatów i brak promptFeedback.blockReason${safetySummary ? `; safetyRatings: ${safetySummary}` : ''}`;
    return {
      ok: false,
      reason,
      ...(blockReason ? { blockReason } : {}),
      ...(safetyRatings.length ? { safetyRatings } : {}),
    };
  }

  const candidate = candidates[0] || {};
  const finishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason.trim() : '';
  const finishMessage = typeof candidate.finishMessage === 'string' ? candidate.finishMessage.trim() : '';
  const safetyRatings = normalizeSafetyRatings(candidate.safetyRatings);
  const safetySummary = summarizeSafetyRatings(safetyRatings);
  const text = (candidate.content?.parts || [])
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();

  if (!text || BLOCKED_FINISH_REASONS.has(finishReason)) {
    const reason = [
      !text ? `${label}: kandydat nie zawiera użytecznej treści tekstowej` : '',
      finishReason ? `finishReason=${finishReason}` : '',
      finishMessage ? `finishMessage=${finishMessage}` : '',
      safetySummary ? `safetyRatings: ${safetySummary}` : '',
    ].filter(Boolean).join('; ');
    return {
      ok: false,
      reason: reason || `${label}: brak użytecznej treści tekstowej`,
      ...(finishReason ? { finishReason } : {}),
      ...(finishMessage ? { finishMessage } : {}),
      ...(safetyRatings.length ? { safetyRatings } : {}),
    };
  }

  return {
    ok: true,
    text,
    truncated: finishReason === 'MAX_TOKENS',
    ...(finishReason ? { finishReason } : {}),
    ...(finishMessage ? { finishMessage } : {}),
    ...(safetyRatings.length ? { safetyRatings } : {}),
  };
}

function buildGeminiGenerateContentUrl(model) {
  const modelId = String(model || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(modelId)) {
    throw new TypeError('Invalid Gemini model ID');
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}

/**
 * Build the documented GenerateContent generationConfig for the JSON validator.
 * Use responseMimeType + responseSchema: responseFormat.text.mimeType is an
 * enum in the REST contract and "application/json" there caused HTTP 400.
 */
function normalizujSchematGeminiREST(schema) {
  if (Array.isArray(schema)) return schema.map(normalizujSchematGeminiREST);
  if (!schema || typeof schema !== 'object') return schema;
  const normalized = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') {
      normalized[key] = value.toUpperCase();
    } else {
      normalized[key] = normalizujSchematGeminiREST(value);
    }
  }
  return normalized;
}

function buildGeminiValidatorGenerationConfig(model, schema) {
  return {
    maxOutputTokens: 1400,
    responseMimeType: 'application/json',
    responseSchema: normalizujSchematGeminiREST(schema),
    ...(model === 'gemini-3.8-flash'
      ? { thinkingConfig: { thinkingLevel: 'low' } }
      : model === 'gemini-3.5-flash-lite'
        ? { thinkingConfig: { thinkingLevel: 'minimal' } }
        : {}),
  };
}

module.exports = {
  parseGeminiGenerationResponse,
  buildGeminiGenerateContentUrl,
  buildGeminiValidatorGenerationConfig,
  normalizujSchematGeminiREST,
};
