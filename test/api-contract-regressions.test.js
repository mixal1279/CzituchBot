'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Gemini REST calls keep API keys out of URLs and use the auth header', () => {
  const source = read('czituch_bot.js');
  assert.equal((source.match(/generativelanguage\.googleapis\.com[^\n]*\?key=/g) || []).length, 0);
  assert.equal((source.match(/x-goog-api-key/g) || []).length, 3);
});

test('answer-completeness repair reapplies deterministic guards before judging', () => {
  const source = read('czituch_bot.js');
  const start = source.indexOf('const repairResult = await generujOdpowiedz(');
  const end = source.indexOf('answerJudge = judgeAnswer(odp, answerPlan);', start);
  assert.ok(start >= 0 && end > start, 'answer completeness repair branch should exist');
  const repairBranch = source.slice(start, end);
  const validationIndex = repairBranch.indexOf('await validateAI(');
  const guardIndex = repairBranch.indexOf('zastosujDeterministyczneGuards(');
  assert.ok(validationIndex >= 0 && guardIndex > validationIndex, 'deterministic guards must run after repair validation');
});

test('Gemini validator and generation fallbacks use documented GenerateContent fields', () => {
  const source = read('czituch_bot.js');
  assert.match(source, /systemInstruction:\s*\{\s*parts:/s);
  assert.equal((source.match(/systemInstruction:\s*\{\s*parts:\s*\[\{\s*text:\s*overrideSystemPrompt\s*\}\]\s*\}/g) || []).length, 2, 'both Gemini generation fallbacks must send the system instruction');
  assert.doesNotMatch(source, /system_instruction:/);
  assert.match(source, /responseFormat:\s*\{\s*text:\s*\{\s*mimeType:\s*'application\/json',\s*schema:\s*GEMINI_VALIDATOR_JSON_SCHEMA/s);
  assert.doesNotMatch(source, /responseMimeType:\s*'application\/json'/);
  assert.doesNotMatch(source, /responseSchema:\s*GEMINI_VALIDATOR_JSON_SCHEMA/);
  assert.doesNotMatch(source, /generationConfig:\s*\{\s*temperature:/, 'Gemini 3.x GenerateContent requests must omit deprecated sampling parameters');
  const webRetrieval = read('ai/webRetrieval.js');
  assert.doesNotMatch(webRetrieval, /generationConfig:\s*\{\s*temperature:/, 'Gemini web retrieval must omit deprecated sampling parameters');
  assert.match(source, /model === 'gemini-3\.8-flash'[\s\S]{0,100}\{ thinkingLevel: 'low' \}/);
  assert.match(source, /model === 'gemini-3\.5-flash-lite'[\s\S]{0,120}\{ thinkingLevel: 'minimal' \}/);
});

test('answer-completeness repair includes the prior answer and uses real line separators', () => {
  const source = read('czituch_bot.js');
  const start = source.indexOf('const verifiedEvidenceContext = (walidacja.claims || [])');
  const end = source.indexOf("'answer completeness repair'", start);
  assert.ok(start >= 0 && end > start, 'answer-completeness repair branch should exist');
  const branch = source.slice(start, end);
  assert.match(branch, /POPRZEDNIA ODPOWIEDŹ DO UZUPEŁNIENIA/);
  assert.match(branch, /Zwróć CAŁĄ poprawioną odpowiedź od początku do końca/);
  assert.doesNotMatch(branch, /\\\\n/, 'prompt fragments must use actual newline escapes, not literal backslash-n text');
});

test('YouTube chat polling respects the interval returned by the API', () => {
  const source = read('czituch_bot.js');
  assert.match(source, /const serverPollDelay = Number\(pollingIntervalMillis\)/);
  assert.match(source, /const initialPollDelay = Number\(res\.data\.pollingIntervalMillis\)/);
  assert.match(source, /let nextPollDelay = 0;[\s\S]{0,180}if \(nextPollDelay > 0\) await czekaj\(nextPollDelay\)/);
  assert.doesNotMatch(source, /Math\.max\([^\n]*pollingIntervalMillis[^\n]*10000/);
  assert.doesNotMatch(source, /Math\.max\([^\n]*initialPollDelay[^\n]*10000/);
  assert.doesNotMatch(source, /reason === 'forbidden'\s*\|\|\s*reason === 'liveChatEnded'/,
    'generic forbidden means missing permission, not necessarily an ended stream');
  assert.match(source, /reason === 'liveChatEnded' \|\| reason === 'liveChatNotFound' \|\| reason === 'liveChatDisabled'/);
});

test('primary generation honors AI_GENERATOR_MODEL and checks quota cooldown before calling Groq', () => {
  const source = read('czituch_bot.js');
  const start = source.indexOf('async function generujOdpowiedz(');
  const end = source.indexOf('const fallbackSteps = {', start);
  assert.ok(start >= 0 && end > start, 'generation orchestration should exist');
  const body = source.slice(start, end);
  assert.match(body, /const primaryModel = AI_MODELS\.generatorPrimary/);
  assert.match(body, /isProviderQuotaBlocked\(primaryStep\)/);
  assert.match(body, /zapytajGlowny\(effectiveMaxTok, prompt, primaryModel\)/);
  assert.match(body, /allowPrimary \? classifyFailure\(result\.error \|\| ''\) : 'validator_rejection'/);
});

test('validator provider preflight uses production timeout budgets', () => {
  const source = read('scripts/validator-providers-preflight.js');
  assert.match(source, /xKiro:\s*Number\(process\.env\.AI_XKIRO_VALIDATOR_TIMEOUT_MS\)\s*\|\|\s*3000/);
  assert.match(source, /OpenRouter:\s*3000/);
  assert.match(source, /Groq:\s*3000/);
  assert.match(source, /result\.ms > productionTimeoutMs/);
  assert.doesNotMatch(source, /PROD_TIMEOUT_MS\s*=\s*9000/);
});

test('live benchmark is manual-only so pushes do not spend API quota', () => {
  const workflow = read('.github/workflows/ai-live-benchmark.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  push:/m);
});

test('TikTok RSS Bridge HTTP errors and non-Atom responses are not mistaken for empty feeds', () => {
  const source = read('czituch_bot.js');
  const start = source.indexOf('async function pobierzWszystkieTikToki(');
  const end = source.indexOf('const TIKTOK_OKNO_NADRABIANIA_MS', start);
  assert.ok(start >= 0 && end > start, 'TikTok RSS Bridge fetcher should exist');
  const fetcher = source.slice(start, end);
  assert.match(fetcher, /RSS Bridge HTTP/);
  assert.match(fetcher, /res\.status/);
  assert.match(fetcher, /non-Atom response/);
});

test('Kick REST helper does not parse JSON error bodies as successful API responses', () => {
  const source = read('czituch_bot.js');
  const start = source.indexOf('async function kickApi(');
  const end = source.indexOf('// Szuka kategorii (gry)', start);
  assert.ok(start >= 0 && end > start, 'Kick REST helper should exist');
  const helper = source.slice(start, end);
  assert.match(helper, /if \(!res\.ok\)/);
  assert.match(helper, /Kick API HTTP/);
  assert.match(helper, /throw new Error/);
});

test('Twitch chat auth errors explain required scopes and try user-token fallback', () => {
  const source = read('czituch_bot.js');
  assert.match(source, /Wymagana wcześniejsza autoryzacja/);
  assert.match(source, /user:write:chat \+ user:bot/);
  assert.match(source, /channel:bot/);
  assert.match(source, /próbuję tokena użytkownika/);
  assert.match(source, /Sprawdź scope user:write:chat/);
});
