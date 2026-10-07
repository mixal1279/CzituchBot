'use strict';

const AI_MODELS = Object.freeze({
  queryRewrite: process.env.AI_QUERY_REWRITE_MODEL || 'openai/gpt-oss-20b',
  validator: process.env.AI_VALIDATOR_MODEL || 'openai/gpt-oss-20b',
  webSearch: process.env.AI_WEB_SEARCH_MODEL || 'gemini-3.8-flash',
  generatorPrimary: process.env.AI_GENERATOR_MODEL || 'openai/gpt-oss-120b',
  generatorGemini: process.env.AI_GEMINI_MODEL || 'gemini-3.8-flash',
  generatorGeminiLite: process.env.AI_GEMINI_LITE_MODEL || 'gemini-3.5-flash-lite',
});

module.exports = { AI_MODELS };
