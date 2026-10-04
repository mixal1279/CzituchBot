'use strict';

function normalizujTokenLiczbowy(token) {
  return String(token || '')
    .toLocaleLowerCase('pl-PL')
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.')
    .trim();
}

function wyodrebnijTwardeTokeny(tekst) {
  const input = String(tekst || '');
  // Celowo nie sprawdzamy gołych liczb: modele mogą użyć numeracji zdań,
  // „2 zdania”, wersji językowej itp. Interesują nas tylko liczby niosące
  // informację faktograficzną: lata, procenty, waluty i jednostki.
  return [...new Set(
    (input.match(/(?:\b(?:19|20)\d{2}\b|\b\d+(?:[.,]\d+)?\s*%|\b\d+(?:[.,]\d+)?\s*(?:zł|pln|usd|eur|gb|mb|tb|hz|fps|°c|stopni|godzin(?:y|ę)?|minut(?:y|ę)?|lat(?:a|)|km|m|kg|g)\b)/giu) || [])
      .map(normalizujTokenLiczbowy)
  )];
}

function sprawdzTwardeFaktyOdpowiedzi(odpowiedz, dane) {
  const answerTokens = wyodrebnijTwardeTokeny(odpowiedz);
  const refs = String(dane || '').toLocaleLowerCase('pl-PL').replace(/,/g, '.');
  const unsupported = answerTokens.filter(token => !refs.includes(token));
  return { ok: unsupported.length === 0, unsupported: unsupported.slice(0, 8), checked: answerTokens };
}

function sprawdzFormatOdpowiedzi(odpowiedz, { maxZdania = 2, maxZnakow = 900 } = {}) {
  const text = String(odpowiedz || '').trim();
  if (!text) return { ok: false, reason: 'pusta odpowiedź' };
  if (text.length > maxZnakow) return { ok: false, reason: 'odpowiedź jest zbyt długa' };
  if (/https?:\/\//i.test(text)) return { ok: false, reason: 'odpowiedź zawiera URL' };

  // Nie traktujemy skrótów typu „np.”/„itd.” jako końca zdania.
  const sentences = text
    .replace(/\b(?:np|itp|itd|tj|tzn)\./gi, '$&')
    .match(/[^.!?]*(?:[.!?]+|$)/g)?.map(s => s.trim()).filter(Boolean) || [];
  if (sentences.length > maxZdania) {
    return { ok: false, reason: `odpowiedź ma więcej niż ${maxZdania} zdania` };
  }
  return { ok: true, reason: 'format poprawny' };
}

module.exports = {
  normalizujTokenLiczbowy,
  wyodrebnijTwardeTokeny,
  sprawdzTwardeFaktyOdpowiedzi,
  sprawdzFormatOdpowiedzi,
};
