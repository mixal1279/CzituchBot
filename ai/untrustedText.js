'use strict';

function replaceUntrustedBlockTags(text) {
  const marker = 'UNTRUSTED_';
  let output = '';
  let cursor = 0;
  let lineStart = 0;

  // Work one line at a time. Computing the line boundary once avoids repeated
  // suffix scans when hostile input contains many malformed marker prefixes.
  while (lineStart < text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const carriageReturn = text.indexOf('\r', lineStart);
    if (carriageReturn !== -1 && carriageReturn < lineEnd) lineEnd = carriageReturn;

    let i = lineStart;
    while (i < lineEnd) {
      const open = text.indexOf('<', i);
      if (open === -1 || open >= lineEnd) break;

      let nameStart = open + 1;
      while (nameStart < lineEnd && /\s/.test(text[nameStart])) nameStart++;
      if (text[nameStart] === '/') nameStart++;
      while (nameStart < lineEnd && /\s/.test(text[nameStart])) nameStart++;

      if (text.slice(nameStart, nameStart + marker.length).toUpperCase() !== marker) {
        i = open + 1;
        continue;
      }

      const tagStart = nameStart + marker.length;
      const close = text.indexOf('>', tagStart);
      if (close === -1 || close >= lineEnd) {
        // No closing bracket exists on this line, so no later marker on this
        // same line can be independently closed either.
        i = lineEnd;
        break;
      }

      output += text.slice(cursor, open) + '[USUNIĘTY_ZNACZNIK_BLOKU]';
      cursor = close + 1;
      i = cursor;
    }

    if (lineEnd === text.length) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1);
  }

  return output + text.slice(cursor);
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
