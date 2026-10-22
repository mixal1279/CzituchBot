'use strict';

function replaceUntrustedBlockTags(text) {
  const marker = 'UNTRUSTED_';
  let output = '';
  let cursor = 0;
  let close = -1;

  while (cursor < text.length) {
    const open = text.indexOf('<', cursor);
    if (open === -1) {
      output += text.slice(cursor);
      break;
    }

    if (close < open) close = text.indexOf('>', open + 1);
    if (close === -1) {
      output += text.slice(cursor);
      break;
    }

    let i = open + 1;
    while (i < close && /\s/.test(text[i])) i++;
    if (text[i] === '/') i++;
    while (i < close && /\s/.test(text[i])) i++;

    if (text.slice(i, i + marker.length).toUpperCase() === marker) {
      output += text.slice(cursor, open) + '[USUNIĘTY_ZNACZNIK_BLOKU]';
      cursor = close + 1;
      close = -1;
    } else {
      output += text.slice(cursor, open + 1);
      cursor = open + 1;
    }
  }

  return output;
}

function sanitizeUntrustedText(material) {
  let text = String(material || '');
  text = text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    // Treść strony nie może udawać nagłówka źródła ani zamykać/otwierać bloków niezaufanych danych.
    .replace(/\[\s*(?:SOURCE|REFERENCE)\b[^\]\r\n]*\]/gi, '[USUNIĘTE_ODWOŁANIE_DO_ŹRÓDŁA]')
    .replace(/<<<\s*(?:END_)?UNTRUSTED[^>\r\n]*>>>/gi, '[USUNIĘTY_ZNACZNIK_BLOKU]')
    .replace(/<!--[\s\S]*?-->/g, '[USUNIĘTY_KOMENTARZ_HTML]')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, '[USUNIĘTY_SKRYPT_HTML]')
    .replace(/<\/?(?:system|developer|assistant|user|tool|instructions?|prompt|context)\b[^>]*>/gi, '[USUNIĘTY_MARKER_ZRODŁA]')
    .replace(/\[\s*(?:system|developer|assistant|user|tool|instructions?|prompt)\s*\]/gi, '[USUNIĘTY_MARKER_ZRODŁA]')
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|messages?)\b/gi, '[USUNIĘTA_INSTRUKCJA_ZRODŁA]')
    .replace(/\b(?:system|developer)\s+(?:message|prompt)\s*:/gi, '[USUNIĘTY_MARKER_ZRODŁA:]')
    .replace(/\b(?:zignoruj|ignoruj|pomiń|pomijaj)\s+(?:wszystkie\s+|te\s+)?(?:poprzednie|wcześniejsze|wczesniejsze|powyższe|powyzsze)\s+(?:instrukcje|zasady|wiadomości|wiadomosci|polecenia)\b/gi, '[USUNIĘTA_INSTRUKCJA_ŹRÓDŁA]')
    .replace(/\b(?:wiadomość|wiadomosc|prompt|instrukcja)\s+(?:systemowa|deweloperska|developera)\s*:/gi, '[USUNIĘTY_MARKER_ŹRÓDŁA:]')
    .replace(/\b(?:you are|act as|jesteś|działaj jako)\s+(?:an?\s+)?(?:assistant|system|developer|model|ai|bot|asystent|systemem|modelem|botem)\b/gi, '[USUNIĘTA_INSTRUKCJA_ROLI]');
  text = replaceUntrustedBlockTags(text);
  return text.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { sanitizeUntrustedText };
