'use strict';

const { resolveGameEntity } = require('./entities');
const { parseEvidenceBlocks } = require('./evidence');
const GAMEFAQS_DOMAIN = 'gamefaqs.gamespot.com';
const GAMEFAQS_NAME = 'GameFAQs';

const GAMEPLAY_INTENT_RE = /(?:jak\s+(?:przej(?:ść|sc)|zrobi(?:ć|c)|pokona(?:ć|c)|zdoby(?:ć|c)|znale(?:źć|zc)|odblokowa(?:ć|c)|rozwiąza(?:ć|c)|ukończy(?:ć|c)|uk(?:o|ó)ńczy(?:ć|c))|jak\s+mam|co\s+(?:mam|trzeba)\s+zrobi(?:ć|c)|gdzie\s+(?:znale(?:źć|zc)|jest|dosta(?:ć|c)|zdoby(?:ć|c))|jak\s+zdoby(?:ć|c)|jak\s+odblokowa(?:ć|c)|jak\s+pokona(?:ć|c)|jak\s+rozwiąza(?:ć|c)|jak\s+przej(?:ść|sc)|walkthrough|walk\s*through|guide|poradnik|solucj|zagadka|boss(?:a|owi|em)?|quest(?:a|u|em)?|misj(?:ę|a|i|e)|zakończeni(?:e|a)|ending|achievement|trofeum|trofe(?:a|ów)|sekret(?:u|y|ne)?|przedmiot(?:u|y)?)/i;
const GAME_CONTEXT_RE = /(?<![\p{L}\p{N}_])(?:(?:gra|gry|grze|grę|grą|gier|game|gaming)(?![\p{L}\p{N}_])|quest|misj(?:a|ę|i|e)|boss|posta(?:ć|ci)|przedmiot|achievement|trofeum|zagadk|walkthrough|poradnik|w\s+grze|z\s+gry|w\s+(?:tej|tejże)\s+grze)/iu;

function czyPytanieOGameplay(pytanie, domeny = null) {
  const p = String(pytanie || '').trim();
  if (!p || p.length > 4000 || !GAMEPLAY_INTENT_RE.test(p)) return false;
  const resolved = resolveGameEntity(p);
  const gamingDomain = Array.isArray(domeny) && domeny.some(d => /(?:gamefaqs\.gamespot\.com|gamelore\.fandom\.com|minecraft\.wiki|ign\.com|gamespot\.com|pcgamer\.com|eurogamer|thewitcher\.com|rockstargames\.com|bandainamco|playstation\.com|naughtydog\.com|baldursgate3\.game|larian\.com|fortnite\.gg)/i.test(String(d)));
  return GAME_CONTEXT_RE.test(p) || gamingDomain || Boolean(resolved);
}

function extractHostname(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    try {
      return new URL(`http://${raw}`).hostname.toLowerCase();
    } catch (__) {
      return null;
    }
  }
}

function dodajGameFAQsDomenę(domeny) {
  // GameFAQs ma być rzeczywistą domeną pierwszego wyszukiwania gameplay.
  // Ścisłe allowlisty kanałów są nakładane później i nadal mają pierwszeństwo.
  const wybrane = Array.isArray(domeny) ? [...domeny] : [];
  if (!wybrane.some(domena => extractHostname(domena) === GAMEFAQS_DOMAIN)) wybrane.push(GAMEFAQS_DOMAIN);
  return wybrane;
}

function wytnijAtrybucjeGameFAQsWszystkie(tekst, dozwoloneSourceIds = null) {
  const t = String(tekst || '').slice(0, 120000);
  const dozwolone = dozwoloneSourceIds instanceof Set
    ? dozwoloneSourceIds
    : Array.isArray(dozwoloneSourceIds)
      ? new Set(dozwoloneSourceIds.map(String))
      : null;
  const wyniki = [];
  const widzianeUrl = new Set();

  for (const source of parseEvidenceBlocks(t)) {
    if (dozwolone && !dozwolone.has(source.sourceId)) continue;
    if (!source.url) continue;
    try {
      const parsed = new URL(source.url);
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== GAMEFAQS_DOMAIN) continue;
      const url = parsed.toString();
      if (widzianeUrl.has(url)) continue;
      widzianeUrl.add(url);
      const title = String(source.title || 'poradnik').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
      wyniki.push({
        sourceId: source.sourceId,
        name: GAMEFAQS_NAME,
        title: title || 'poradnik',
        url,
      });
    } catch (_) {
      continue;
    }
  }
  return wyniki;
}

function wytnijAtrybucjeGameFAQs(tekst, dozwoloneSourceIds = null) {
  return wytnijAtrybucjeGameFAQsWszystkie(tekst, dozwoloneSourceIds)[0] || null;
}

module.exports = { GAMEFAQS_DOMAIN, GAMEFAQS_NAME, czyPytanieOGameplay, dodajGameFAQsDomenę, wytnijAtrybucjeGameFAQs, wytnijAtrybucjeGameFAQsWszystkie };
