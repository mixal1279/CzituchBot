'use strict';

// Szybki test klucza Tavily przed drogim live benchmarkiem (zużywa 1 kredyt).
// Dzięki temu wyczerpany limit/zły klucz kończy job od razu, zamiast
// produkować mylące wyniki 0/10 po 2 minutach.
const FATAL_STATUSES = new Set([401, 403, 429, 432, 433]);

async function main() {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    console.error('::error::Brak TAVILY_API_KEY w secrets repozytorium.');
    return 2;
  }
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: 'Portal 2 GLaDOS', max_results: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      console.log('[preflight] Tavily OK');
      return 0;
    }
    const body = (await res.text()).slice(0, 300);
    if (FATAL_STATUSES.has(res.status)) {
      console.error(`::error::Tavily HTTP ${res.status}: ${body}`);
      return 3;
    }
    console.warn(`::warning::Tavily HTTP ${res.status}: ${body} - kontynuuję`);
    return 0;
  } catch (error) {
    console.warn(`::warning::Preflight Tavily nieudany (${error?.message || error}) - kontynuuję`);
    return 0;
  }
}

main().then(code => { process.exitCode = code; });
