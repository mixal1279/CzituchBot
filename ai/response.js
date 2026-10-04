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

const KONTEKSTY_GIER_AI = [
  { name: 'Cyberpunk 2077', patterns: [/\bcyberpunk(?:\s*2077)?\b/i, /\barasaka\b/i, /\bnight\s*city\b/i, /\bjohnny\s+silverhand\b/i, /\brelik|relic\b/i, /\bv\s+(?:z|w)\s+cyberpunk/i] },
  { name: 'Red Dead Redemption', patterns: [/\bred\s+dead\b/i, /\brdr2\b/i, /\barthur\s+morgan\b/i, /\bdutch\s+van\s+der\s+linde\b/i, /\bjohn\s+marston\b/i, /\bthomas\s+downes\b/i] },
  { name: 'Portal', patterns: [/\bportal(?:\s*[12])?\b/i, /\bglados\b/i, /\bchell\b/i, /\baperture\s+science\b/i] },
  { name: 'God of War', patterns: [/\bgod\s+of\s+war\b/i, /\bkratos\b/i, /\bzeus\b/i, /\bsparta\b/i] },
  { name: 'The Last of Us', patterns: [/\bthe\s+last\s+of\s+us\b/i, /\btlou\b/i, /\bjoel\s+miller\b/i, /\bellie\b/i] },
  { name: 'Minecraft', patterns: [/\bminecraft\b/i, /\bcreeper\b/i, /\bnether\b/i, /\bend(?:er)?\s+dragon\b/i] },
  { name: 'The Witcher', patterns: [/\bwied[źz]min\b/i, /\bwitcher\b/i, /\bgeralt\b/i, /\bciri\b/i] },
];

function wykryjKontekstyGierAI(tekst) {
  return KONTEKSTY_GIER_AI.filter(kontekst => kontekst.patterns.some(re => re.test(String(tekst || '')))).map(kontekst => kontekst.name);
}

function sprawdzZgodnoscKontekstuGry(odpowiedz, pytanie) {
  const questionGames = wykryjKontekstyGierAI(pytanie);
  const answerGames = wykryjKontekstyGierAI(odpowiedz);
  if (!questionGames.length) return { ok: true, conflicting: [] };
  const conflicting = answerGames.filter(name => !questionGames.includes(name));
  return { ok: conflicting.length === 0, conflicting };
}

function sprawdzTwardeFaktyOdpowiedzi(odpowiedz, dane, pytanie = '') {
  const questionTokens = new Set(wyodrebnijTwardeTokeny(pytanie));
  // Liczby obecne już w pytaniu mogą być częścią nazwy encji (np. Cyberpunk 2077).
  // Validator semantyczny nadal sprawdza zgodność całej odpowiedzi z pytaniem i źródłami.
  const answerTokens = wyodrebnijTwardeTokeny(odpowiedz).filter(token => !questionTokens.has(token));
  const refs = String(dane || '').toLocaleLowerCase('pl-PL').replace(/,/g, '.');
  const unsupported = answerTokens.filter(token => !refs.includes(token));
  const contextCheck = sprawdzZgodnoscKontekstuGry(odpowiedz, pytanie);
  const contextUnsupported = contextCheck.conflicting.map(name => `odpowiedź wprowadza inną grę/uniwersum: ${name}`);
  return {
    ok: unsupported.length === 0 && contextCheck.ok,
    unsupported: [...unsupported, ...contextUnsupported].slice(0, 8),
    checked: answerTokens,
    conflictingGames: contextCheck.conflicting,
  };
}

function sprawdzFormatOdpowiedzi(odpowiedz, { maxZdania = 2, maxZnakow = 900 } = {}) {
  const text = String(odpowiedz || '').trim();
  if (!text) return { ok: false, reason: 'pusta odpowiedź' };
  if (text.length > maxZnakow) return { ok: false, reason: 'odpowiedź jest zbyt długa' };
  if (/https?:\/\//i.test(text)) return { ok: false, reason: 'odpowiedź zawiera URL' };

  // Liczymy tylko interpunkcję kończącą zdanie; kropka w liczbie 2.5
  // nie może zostać potraktowana jako koniec zdania.
  const normalized = text.replace(/\b(?:np|itp|itd|tj|tzn)\./gi, '§');
  const sentenceCount = (normalized.match(/[.!?]+(?=\s|$)/g) || []).length;
  if (sentenceCount > maxZdania) {
    return { ok: false, reason: `odpowiedź ma więcej niż ${maxZdania} zdania` };
  }
  return { ok: true, reason: 'format poprawny' };
}

module.exports = {
  normalizujTokenLiczbowy,
  wyodrebnijTwardeTokeny,
  sprawdzTwardeFaktyOdpowiedzi,
  sprawdzZgodnoscKontekstuGry,
  sprawdzFormatOdpowiedzi,
};
