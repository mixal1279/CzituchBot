#!/usr/bin/env node
'use strict';
// Uruchom z katalogu glownego repo: node apply-fixes.js
// Skrypt jest idempotentny: jesli poprawka juz jest naniesiona, pomija ja
// z komunikatem "juz obecna" zamiast sie wywalic.

const fs = require('fs');
const path = require('path');

function patchFile(filePath, fixes) {
  const full = path.resolve(process.cwd(), filePath);
  let content;
  try {
    content = fs.readFileSync(full, 'utf8');
  } catch (err) {
    console.error(`  [BLAD] nie moge otworzyc ${filePath} (${err.code}). Uruchamiasz skrypt z glownego katalogu repo?`);
    process.exitCode = 1;
    return false;
  }
  let changed = false;

  for (const fix of fixes) {
    if (content.includes(fix.marker)) {
      console.log(`  [pomijam] ${fix.name} — juz obecna w ${filePath}`);
      continue;
    }
    const count = content.split(fix.search).length - 1;
    if (count === 0) {
      console.error(`  [BLAD] ${fix.name} — nie znaleziono kotwicy w ${filePath}. Plik pewnie zmienil sie od czasu diagnozy. Wklej mi fragment wokol miejsca, ktorego szukam:\n    ${fix.search.slice(0, 80)}...`);
      process.exitCode = 1;
      continue;
    }
    if (count > 1) {
      console.error(`  [BLAD] ${fix.name} — kotwica wystapila ${count} razy (oczekiwano 1) w ${filePath}. Nie nanosze, zeby nie trafic w zle miejsce.`);
      process.exitCode = 1;
      continue;
    }
    content = content.replace(fix.search, fix.replace);
    changed = true;
    console.log(`  [OK] ${fix.name} — naniesiona w ${filePath}`);
  }

  if (changed) fs.writeFileSync(full, content, 'utf8');
  return changed;
}

console.log('ai/claimValidation.js:');
patchFile('ai/claimValidation.js', [
  {
    name: "pojecie 'uwolnienie' w CROSS_LANGUAGE_CONCEPTS",
    marker: "['uwolnienie',",
    search: "  ['pomoc', /help\\w*|assist\\w*|save\\w*|rescu\\w*|pomog\\w*|pomaga\\w*|urat\\w*|ocal\\w*/i],",
    replace:
      "  ['pomoc', /help\\w*|assist\\w*|save\\w*|rescu\\w*|pomog\\w*|pomaga\\w*|urat\\w*|ocal\\w*/i],\n" +
      "  // Dodane po przypadku benchmarkowym who-225 (Astarion): cytat 'freed him\n" +
      "  // from his bonds' nie byl rozpoznawany jako potwierdzenie claimu 'zostal\n" +
      "  // uwolniony', bo zadne pojecie nie lapalo pary freed/uwolniony.\n" +
      "  ['uwolnienie', /\\bfree(?:d|s|ing)?\\b|\\breleas(?:e|es|ed|ing)\\b|liberat\\w*|uwolni\\w*|wyzwoli\\w*/i],",
  },
  {
    name: "wyjatek dla frazy kontrastowej 'X, a nie Y' w tekstDoWykrywaniaNegacji",
    marker: ",?\\s*a\\s+nie\\s+",
    search: "  cleaned = cleaned.replace(/\\band\\s+[^,.!?;:]*?\\bwithout\\s+[^,.!?;:]*/giu, (match) => {",
    replace:
      "  // Fraza kontrastowa 'X, a nie Y, ...' poprawia/precyzuje encje, a nie neguje\n" +
      "  // glownego orzeczenia zdania, np. 'W grze Portal, a nie Portal 2, Chell budzi\n" +
      "  // sie w Aperture Science' to twierdzenie POZYTYWNE o Portalu, nie zaprzeczenie.\n" +
      "  // Bez tego wyciecia samo 'nie' w dopowiedzeniu falszywie oznaczalo caly claim\n" +
      "  // jako zanegowany (benchmark: przypadek when-115 / Chell).\n" +
      "  cleaned = cleaned.replace(/,?\\s*a\\s+nie\\s+[^,.!?;:]+(?=[,.!?;:]|$)/giu, ' ');\n" +
      "  cleaned = cleaned.replace(/\\bnot\\s+[^,.!?;:]+?,\\s*(?:but|rather)\\s+/giu, ' ');\n" +
      "  cleaned = cleaned.replace(/\\band\\s+[^,.!?;:]*?\\bwithout\\s+[^,.!?;:]*/giu, (match) => {",
  },
]);

console.log('ai/core.js:');
patchFile('ai/core.js', [
  {
    name: 'lagodna degradacja w assessEvidence przy zerowaniu kandydatow przez filtr zakresu',
    marker: 'const scopeFiltered = normalizedSources',
    search:
      "  const normalized = (Array.isArray(results) ? results : [])\n" +
      "    .filter(Boolean)\n" +
      "    .map((source, index) => normalizeSource(source, index))\n" +
      "    .filter(source => sourceMatchesRequestContext(source, routing, question))\n" +
      "    .filter(source => sourceLanguageCompatible(source, question, routing))\n" +
      "    .map((s, index) => scoreSource(s, question, {\n" +
      "      index,\n" +
      "      // Score against both the resolved character/item and its parent game.\n" +
      "      // A game name must not shadow a more specific entity mention.\n" +
      "      entities: [\n" +
      "        routing.resolved_entity?.name,\n" +
      "        routing.entity,\n" +
      "        routing.game,\n" +
      "        routing.resolved_entity?.game,\n" +
      "      ],\n" +
      "      freshness: routing.freshness,\n" +
      "    }));",
    replace:
      "  const normalizedSources = (Array.isArray(results) ? results : [])\n" +
      "    .filter(Boolean)\n" +
      "    .map((source, index) => normalizeSource(source, index));\n" +
      "  const scopeFiltered = normalizedSources\n" +
      "    .filter(source => sourceMatchesRequestContext(source, routing, question))\n" +
      "    .filter(source => sourceLanguageCompatible(source, question, routing));\n" +
      "  // Gdy filtr zakresu (postac/gra) odrzuci WSZYSTKIE wyniki mimo ze retrieval\n" +
      "  // faktycznie cos zwrocil, evidence spadalo do zera kandydatow i request\n" +
      "  // konczyl sie odmowa (benchmark: outcome-393, why-002 — providerCounts.tavily=1,\n" +
      "  // ale candidateCount=0). Zachowujemy najlepiej dopasowane zrodlo sprzed filtra\n" +
      "  // zakresu jako slaby, ale niepusty material.\n" +
      "  const scopedSources = scopeFiltered.length > 0\n" +
      "    ? scopeFiltered\n" +
      "    : (normalizedSources.length > 0\n" +
      "      ? [normalizedSources\n" +
      "          .map((source, index) => ({ source, score: scoreSource(source, question, { index }).coreScore }))\n" +
      "          .sort((a, b) => b.score - a.score)[0].source]\n" +
      "      : []);\n" +
      "  const normalized = scopedSources.map((s, index) => scoreSource(s, question, {\n" +
      "    index,\n" +
      "    // Score against both the resolved character/item and its parent game.\n" +
      "    // A game name must not shadow a more specific entity mention.\n" +
      "    entities: [\n" +
      "      routing.resolved_entity?.name,\n" +
      "      routing.entity,\n" +
      "      routing.game,\n" +
      "      routing.resolved_entity?.game,\n" +
      "    ],\n" +
      "    freshness: routing.freshness,\n" +
      "  }));",
  },
]);

console.log('czituch_bot.js (diagnostyka HLTB):');
patchFile('czituch_bot.js', [
  {
    name: 'log diagnostyczny przy non-OK w szukajHLTBBleed',
    marker: '[HLTB][diag] /api/search/site',
    search:
      "    return szukajHLTBBleed(gameName, true);\n" +
      "  }\n" +
      "  if (!res.ok) return null;\n" +
      "  return res.json();\n" +
      "}",
    replace:
      "    return szukajHLTBBleed(gameName, true);\n" +
      "  }\n" +
      "  if (!res.ok) {\n" +
      "    let bodySnippet = '';\n" +
      "    try { bodySnippet = (await res.text()).slice(0, 300); } catch (_) { /* ignore */ }\n" +
      "    console.log('[HLTB][diag] /api/search/site odpowiedzialo non-OK:', res.status, bodySnippet);\n" +
      "    return null;\n" +
      "  }\n" +
      "  return res.json();\n" +
      "}",
  },
  {
    name: 'log diagnostyczny przy pustym data.data w pobierzCzasHLTB',
    marker: '[HLTB][diag] pusta odpowiedz',
    search:
      "      const data = await szukajHLTBBleed(wariant);\n" +
      "      if (!data || !data.data || data.data.length === 0) continue;\n",
    replace:
      "      const data = await szukajHLTBBleed(wariant);\n" +
      "      if (!data || !data.data || data.data.length === 0) {\n" +
      "        console.log('[HLTB][diag] pusta odpowiedz dla wariantu:', wariant, '- surowe dane:', JSON.stringify(data).slice(0, 300));\n" +
      "        continue;\n" +
      "      }\n",
  },
]);

console.log('\nGotowe. Sprawdz `git diff`, zeby zobaczyc dokladne zmiany.');
