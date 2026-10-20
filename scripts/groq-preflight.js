'use strict';

// Pozwala uruchamiać preflight lokalnie z .env; w GitHub Actions sekret nadal pochodzi z env.
require('dotenv').config({ quiet: true });

// Szybki test limitów Groq przed live benchmarkiem (kilka tokenów na model).
// Powód: 14 października run kończył się wynikiem 0/5, bo dzienny limit tokenów (TPD)
// obu modeli Groq był wyczerpany. Taki wynik mierzy limity, nie jakość kodu, więc
// job ma się zatrzymać od razu z czytelnym komunikatem.
const { AI_MODELS } = require('../ai/modelConfig');
const { normalizujGroqBaseUrl } = require('../ai/provider-runtime');

const ENDPOINT = `${normalizujGroqBaseUrl(process.env.GROQ_BASE_URL)}/openai/v1/chat/completions`;

function describeRetry(message) {
  const m = String(message || '').match(/try again in ([0-9hms.]+)/i);
  return m ? ` (Groq: spróbuj za ${m[1]})` : '';
}

async function checkModel(model, key) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_completion_tokens: 1, reasoning_effort: 'low' }),
    signal: AbortSignal.timeout(20000),
  });
  if (res.ok) return { model, ok: true };
  const text = (await res.text()).slice(0, 600);
  let message = text;
  try { message = JSON.parse(text)?.error?.message || text; } catch (_) { /* surowy tekst */ }
  const perDay = /tokens per day|TPD|requests per day|RPD/i.test(message);
  return { model, ok: false, status: res.status, perDay, message, retry: describeRetry(message) };
}

async function main() {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.error('::error::Brak GROQ_API_KEY w środowisku. Ustaw zmienną środowiskową, sekret GitHub Actions albo wpis w lokalnym .env.');
    return 2;
  }
  const models = [...new Set([AI_MODELS.generatorPrimary, AI_MODELS.validator, AI_MODELS.queryRewrite].filter(Boolean))];
  let fatal = false;
  for (const model of models) {
    try {
      const r = await checkModel(model, key);
      if (r.ok) {
        console.log(`[preflight] Groq ${model}: OK`);
      } else if (r.status === 429 && r.perDay) {
        console.error(`::error::Groq ${model}: dzienny limit wyczerpany${r.retry}. Wynik benchmarku byłby nieważny.`);
        fatal = true;
      } else if (r.status === 401 || r.status === 403) {
        console.error(`::error::Groq ${model}: HTTP ${r.status} (klucz). ${r.message}`);
        fatal = true;
      } else {
        console.warn(`::warning::Groq ${model}: HTTP ${r.status}: ${String(r.message).slice(0, 200)}${r.retry || ''} - kontynuuję`);
      }
    } catch (error) {
      console.warn(`::warning::Preflight Groq ${model} nieudany (${error?.message || error}) - kontynuuję`);
    }
  }
  return fatal ? 3 : 0;
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, describeRetry };
