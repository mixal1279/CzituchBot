'use strict';

function buildGeminiCountTokensBody(body = {}) {
  const {
    generationConfig,
    systemInstruction,
    ...countBody
  } = body && typeof body === 'object' ? body : {};

  const systemText = Array.isArray(systemInstruction?.parts)
    ? systemInstruction.parts.map(part => String(part?.text || '')).filter(Boolean).join('\n')
    : '';
  const contents = Array.isArray(countBody.contents) ? countBody.contents : [];

  if (systemText) {
    // countTokens nie akceptuje systemInstruction. Dodajemy jego tekst do
    // liczonej treści, aby nie zaniżać kosztu wejścia i zachować zgodność API.
    countBody.contents = [
      { role: 'user', parts: [{ text: systemText }] },
      ...contents,
    ];
  }

  return countBody;
}

module.exports = { buildGeminiCountTokensBody };
