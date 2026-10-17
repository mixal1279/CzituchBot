'use strict';

const { resolveGameEntity } = require('./entities');
const GAMELORE_DOMAIN = 'gamelore.fandom.com';
const GAMELORE_NAME = 'GameLore Wiki';

const LORE_INTENT_RE = /\b(?:lore|fabuł[aeęy]|histori(?:a|ę|ii)\s+(?:gry|postaci|świata)|kim\s+(?:[\p{L}]+\s+){0,2}(?:jest|był|była|byli)(?=\s|$)|kto\s+(?:[\p{L}]+\s+){0,2}(?:to|jest|był|była)(?=\s|$)|co\s+się\s+stało|co\s+się\s+wydarzyło|dlaczego\b|pochodzeni[ae]|backstory|kanon|canon|timeline|histori[aęy]\s+świata|świat\s+gry|wydarzeni(?:a|ach)\s+w\s+grze|relacj[ae]\s+(?:między|z)|zwi[aą]zk(?:u|i|iem|ach)|konflikt(?:u|em|ach)?|wpływ(?:u|em)?|wpłyn(?:ął|ęło|ęła|ęły)|postaci(?:ą|e|ach)\s+w\s+grze)/iu;
const GAME_TITLE_RE = /\b(?:minecraft|portal(?:\s+2)?|red\s+dead(?:\s+redemption)?(?:\s+2)?|cyberpunk(?:\s+2077)?|wied[źz]min(?:\s+3)?|witcher(?:\s+3)?|gta(?:\s+[iv1-6]+)?|grand\s+theft\s+auto|fallout(?:\s+\d+)?|skyrim|starfield|elden\s+ring|dark\s+souls|baldur[’']?s\s+gate(?:\s+3)?|the\s+last\s+of\s+us|god\s+of\s+war|assassin'?s\s+creed|fortnite)\b/i;
const GAME_CONTEXT_RE = /(?<![\p{L}\p{N}_])(?:gra|gry|grze|grę|grą|gier|game|gaming|w\s+(?:tej|tejże)\s+grze|w\s+grze|z\s+gry|postać|postaci|boss|bohater|bohaterka|fabuła|lore|kanon|canon|quest|misja|świat\s+gry)(?![\p{L}\p{N}_])/iu;

function czyPytanieOLore(pytanie, domeny = null) {
  const p = String(pytanie || '').trim();
  if (!p) return false;
  const resolved = resolveGameEntity(p);
  const loreIntent = LORE_INTENT_RE.test(p) || (resolved && /\b(?:dlaczego|kim|kto|co|histori\w*|lore|pochodzeni\w*|kanon|timeline|zwi[aą]zk\w*|relacj\w*|konflikt\w*|wpływ\w*|wpłyn\w*)\b/i.test(p));
  if (!loreIntent) return false;
  const gamingDomain = Array.isArray(domeny) && domeny.some(d => /(?:minecraft\.wiki|gamelore\.fandom\.com|fandom\.com|ign\.com|gamespot\.com|pcgamer\.com|eurogamer|rockstargames\.com|thewitcher\.com|bandainamco|playstation\.com|naughtydog\.com|baldursgate3\.game|larian\.com|fortnite\.gg)/i.test(String(d)));
  return GAME_CONTEXT_RE.test(p) || GAME_TITLE_RE.test(p) || gamingDomain || Boolean(resolved);
}

function dodajGameLoreDomenę(domeny) {
  const lista = Array.isArray(domeny) ? [...domeny] : [];
  if (!lista.includes(GAMELORE_DOMAIN)) lista.unshift(GAMELORE_DOMAIN);
  return lista;
}

function wytnijAtrybucjeGameLore(tekst) {
  const t = String(tekst || '');
  const match = t.match(/\[SOURCE\s+\d+\][\s\S]*?HOST:\s*gamelore\.fandom\.com[\s\S]*?URL:\s*(https?:\/\/[^\s\n]+)/i);
  if (!match) return null;
  const blok = match[0];
  const title = blok.match(/TYTUŁ:\s*([^\n]+)/i)?.[1]?.trim() || 'artykuł';
  const url = blok.match(/URL:\s*(https?:\/\/[^\s\n]+)/i)?.[1]?.trim() || null;
  return url ? { name: GAMELORE_NAME, title, url, license: 'CC BY-SA' } : null;
}

module.exports = { GAMELORE_DOMAIN, GAMELORE_NAME, czyPytanieOLore, dodajGameLoreDomenę, wytnijAtrybucjeGameLore };
