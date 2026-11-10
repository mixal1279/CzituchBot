'use strict';

const AI_MODELS = Object.freeze({
  queryRewrite: process.env.AI_QUERY_REWRITE_MODEL || 'openai/gpt-oss-20b',
  validator: process.env.AI_VALIDATOR_MODEL || 'openai/gpt-oss-20b',
  webSearch: process.env.AI_WEB_SEARCH_MODEL || 'gemini-3.8-flash',
  generatorPrimary: process.env.AI_GENERATOR_MODEL || 'openai/gpt-oss-120b',
  generatorGemini: process.env.AI_GEMINI_MODEL || 'gemini-3.8-flash',
  generatorGeminiLite: process.env.AI_GEMINI_LITE_MODEL || 'gemini-3.5-flash-lite',
});

function resolvePrimaryGenerator(env = process.env) {
  const configuredProvider = String(env.AI_GENERATOR_PROVIDER || 'groq').trim().toLowerCase();
  if (!['groq', 'xkiro'].includes(configuredProvider)) {
    throw new TypeError('AI_GENERATOR_PROVIDER must be either "groq" or "xkiro"');
  }
  if (configuredProvider === 'xkiro') {
    const model = String(env.XKIRO_MODEL || 'qwen/qwen3.5-397b-a17b:free').trim();
    if (!model) throw new TypeError('XKIRO_MODEL cannot be empty when xKiro is the primary generator');
    return Object.freeze({ provider: 'xkiro', model, step: 'xkiro:default' });
  }
  const model = String(env.AI_GENERATOR_MODEL || AI_MODELS.generatorPrimary).trim();
  if (!model) throw new TypeError('AI_GENERATOR_MODEL cannot be empty when Groq is the primary generator');
  return Object.freeze({ provider: 'groq', model, step: `groq:${model}` });
}

const AI_PRIMARY_GENERATOR = resolvePrimaryGenerator();

module.exports = { AI_MODELS, AI_PRIMARY_GENERATOR, resolvePrimaryGenerator };
