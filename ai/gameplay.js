'use strict';

const { resolveGameEntity } = require('./entities');
const GAMEFAQS_DOMAIN = 'gamefaqs.gamespot.com';
const GAMEFAQS_NAME = 'GameFAQs';

const GAMEPLAY_INTENT_RE = /(?:jak\s+(?:przej(?:ść|sc)|zrobi(?:ć|c)|pokona(?:ć|c)|zdoby(?:ć|c)|znale(?:źć|zc)|odblokowa(?:ć|c)|rozwiąza(?:ć|c)|ukończy(?:ć|c)|uk(?:o|ó)ńczy(?:ć|c))|jak\s+mam|co\s+(?:mam|trzeba)\s+zrobi(?:ć|c)|gdzie\s+(?:znale(?:źć|zc)|jest|dosta(?:ć|c)|zdoby(?:ć|c))|jak\s+zdoby(?:ć|c)|jak\s+odblokowa(?:ć|c)|jak\s+pokona(?:ć|c)|jak\s+rozwiąza(?:ć|c)|jak\s+przej(?:ść|sc)|walkthrough|walk\s*through|guide|poradnik|solucj|zagadka|boss(?:a|owi|em)?|quest(?:a|u|em)?|misj(?:ę|a|i|e)|zakończeni(?:e|a)|ending|achievement|trofeum|trofe(?:a|ów)|sekret(?:u|y|ne)?|przedmiot(?:u|y)?)/i;
const GAME_CONTEXT_RE = /(?<![\p{L}\p{N}_])(?:(?:gra|gry|grze|grę|grą|gier|game|gaming)(?![\p{L}\p{N}_])|quest|misj(?:a|ę|i|e)|boss|posta(?:ć|ci)|przedmiot|achievement|trofeum|zagadk|walkthrough|poradnik|w\s+grze|z\s+gry|w\s+(?:tej|tejże)\s+grze)/iu;

function czyPytanieOGameplay(pytanie, domeny = null) {
  const p = String(pytanie || '').trim();
  if (!p || !GAMEPLAY_INTENT_RE.test(p)) return false;
  const resolved = resolveGameEntity(p);
  const gamingDomain = Array.isArray(domeny) && domeny.some(d => /(?:gamefaqs\.gamespot\.com|gamelore\.fandom\.com|minecraft\.wiki|fandom\.com|ign\.com|gamespot\.com|pcgamer\.com|eurogamer|thewitcher\.com|rockstargames\.com|bandainamco|playstation\.com|naughtydog\.com|baldursgate3\.game|larian\.com|fortnite\.gg)/i.test(String(d)));
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
  const lista = Array.isArray(domeny) ? [...domeny] : [];
  const hasGameFAQs = lista.some((d) => extractHostname(d) === GAMEFAQS_DOMAIN);
  if (!hasGameFAQs) lista.unshift(GAMEFAQS_DOMAIN);
  return lista;
}

function wytnijAtrybucjeGameFAQs(tekst) {
  const t = String(tekst || '');
  const match = t.match(/\[SOURCE\s+\d+\][\s\S]*?HOST:\s*gamefaqs\.gamespot\.com[\s\S]*?URL:\s*(https?:\/\/[^\s\n]+)/i);
  if (!match) return null;
  const blok = match[0];
  const title = blok.match(/TYTUŁ:\s*([^\n]+)/i)?.[1]?.trim() || 'poradnik';
  const url = blok.match(/URL:\s*(https?:\/\/[^\s\n]+)/i)?.[1]?.trim() || null;
  return url ? { name: GAMEFAQS_NAME, title, url } : null;
}

module.exports = { GAMEFAQS_DOMAIN, GAMEFAQS_NAME, czyPytanieOGameplay, dodajGameFAQsDomenę, wytnijAtrybucjeGameFAQs };
