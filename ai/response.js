'use strict';

const { parseEvidenceBlocks, removeLeadingSourceMetadataNoise } = require('./evidence');

function normalizujTokenLiczbowy(token) {
  const text = String(token || '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .trim();
  // Normalizuj separatory tysięcy przed zamianą separatora dziesiętnego:
  // 50,000 / 50.000 / 50 000 => 50000; 2,5 / 2.50 => 2.5.
  const normalized = text
    .replace(/(?<=\d)\s(?=\d{3}(?:\D|$))/gu, '')
    .replace(/(\d)[,.](\d{3})(?=\D|$)/gu, '$1$2')
    .replace(/,/g, '.');
  const match = normalized.match(/^(\d+(?:\.\d+)?)(\s*)(.*)$/u);
  if (!match) return text;
  const number = Number(match[1]);
  return `${Number.isFinite(number) ? String(number) : match[1]}${match[2]}${match[3]}`.trim();
}

function wyodrebnijTwardeTokeny(tekst) {
  const input = String(tekst || '');
  // `\b` jest ASCII-only i nie działa po „ł”/„ę” (np. „100 zł”), dlatego lookaroundy Unicode.
  const re = /(?:(?<![\p{L}\p{N}_.,])(?:19|20)\d{2}(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_.,])\d+(?:[.,]\d+)?\s*%|(?<![\p{L}\p{N}_.,])\d+(?:[.,]\d+)?\s*(?:zł|pln|usd|eur|gb|mb|tb|hz|fps|°c|stopni|godzin(?:y|ę|ach)?|minut(?:y|ę|ach)?|lat(?:a|)|km|m|kg|g)(?![\p{L}\p{N}_]))/giu;
  // Liczby słowne („trzysta”, „dwadzieścia”) celowo NIE są tu dokładane:
  // to porównanie odpowiedzi z źródłem bywa międzyjęzykowe (polska odpowiedź
  // wobec angielskiego źródła), a „trzysta” po polsku to „three hundred” po
  // angielsku. Wtedy każda polska liczba słowna byłaby fałszywie zgłaszana
  // jako niepotwierdzona. Liczby słowne porównujemy w obrębie jednego języku
  // (ai/claimValidation.js: liczbyDoPorownania).
  return [...new Set((input.match(re) || []).map(normalizujTokenLiczbowy))];
}

// Skróty z kropką („2020 r.”, „ok.”, „m.in.”) nie kończą zdania. Zamieniamy tylko kropkę
// na znak o tej samej długości, więc indeksy w tekście pozostają zgodne.
function maskSentenceAbbreviations(text) {
  return String(text || '')
    .replace(/(?<![\p{L}])(?:np|itp|itd|tj|tzn)\./giu, m => m.slice(0, -1) + '\u2024')
    .replace(/(?<![\p{L}])m\.in\./giu, 'm\u2024in\u2024')
    .replace(/(?<![\p{L}\p{N}])(?:r|ok|tys|mln|mld|godz|tzw|ang|pol|zob|wg|ur|zm|nr|str|ul|im|dr|prof|inż|mgr|św)\.(?=\s+[\p{Ll}\d(„"“])/giu, m => m.slice(0, -1) + '\u2024');
}

function zawieraTokenTwardy(refs, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Token kończący się literą (jednostka) może się odmieniać; kończący się cyfrą/% wymaga granicy.
  const tail = /\p{L}$/u.test(token) ? '' : '(?![\\p{L}\\p{N}_])';
  return new RegExp('(?<![\\p{L}\\p{N}_.])' + escaped + tail, 'u').test(refs);
}

const KONTEKSTY_GIER_AI = [
  { name: 'Cyberpunk 2077', patterns: [/\bcyberpunk(?:\s*2077)?\b/i, /\barasaka\b/i, /\bnight\s*city\b/i, /\bjohnny\s+silverhand\b/i, /\brelic\s+(?:chip|malfunction)\b/i, /\bv\s+(?:z|w)\s+cyberpunk/i] },
  { name: 'Red Dead Redemption', patterns: [/\bred\s+dead\b/i, /\brdr2\b/i, /\barthur\s+morgan\b/i, /\bdutch\s+van\s+der\s+linde\b/i, /\bjohn\s+marston\b/i, /\bthomas\s+downes\b/i] },
  { name: 'Portal', patterns: [/\bportal(?:\s*[12])?\b/i, /\bglados\b/i, /\bchell\b/i, /\baperture\s+science\b/i] },
  { name: 'God of War', patterns: [/\bgod\s+of\s+war\b/i, /\bkratos\b/i, /\bzeus\b/i, /\bsparta\b/i] },
  { name: 'The Last of Us', patterns: [/\bthe\s+last\s+of\s+us\b/i, /\btlou\b/i, /\bjoel\s+miller\b/i, /\bellie\b/i] },
  { name: 'Minecraft', patterns: [/\bminecraft\b/i, /\bcreeper\b/i, /\bnether\b/i, /\bend(?:er)?\s+dragon\b/i] },
  { name: 'The Witcher', patterns: [/\bwied[źz]min\b/i, /\bwitcher\b/i, /\bgeralt\b/i, /\bciri\b/i] },
  { name: 'Dying Light', patterns: [/\bdying\s*light(?:\s*:\s*|\s+)the\s+beast\b/i, /\bdying\s+light\b/i] },
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

function sprawdzSpojnoscLorePortal2(odpowiedz, pytanie) {
  const q = String(pytanie || '').toLocaleLowerCase('pl-PL');
  const a = String(odpowiedz || '').toLocaleLowerCase('pl-PL');
  const portal = /\bportal\s*2\b|\bwheatley\b|\bglados\b|\bchell\b|\baperture\s+science\b/i.test(q);
  if (!portal) return { ok: true, unsupported: [] };

  const pytaOPrzejecie = /\bwheatley\b/i.test(q)
    && /(?:^|[^\p{L}])(?:przejął|przejęła|przejęcie|przej[aą]ł|kontrolę|władzę|wladze)(?=$|[^\p{L}])/iu.test(q);
  if (!pytaOPrzejecie) return { ok: true, unsupported: [] };

  // Celowo NIE wymagamy tu żadnej treści poprawnej odpowiedzi (wcześniej odpowiedź musiała opisywać
  // „transfer rdzenia”): taki wymóg był kluczem odpowiedzi do jednego pytania i odrzucał poprawne
  // odpowiedzi sformułowane inaczej. Ugruntowanie w źródłach sprawdza walidator. Poniższe reguły tylko
  // odrzucają konkretne, znane fałszywe twierdzenia.

  const przyciskJakoBezposredniaPrzyczyna =
    /(?:przejął|przejąć|przej[aą]ł|zdobył|uzyskał|dostał|otrzymał)[^.!?]{0,180}(?:bo|ponieważ|dlatego|dzięki|przez)[^.!?]*(?:przycisk|rozwiązania?\s+(?:sytuacji\s+)?patowej|rozwiązania?\s+impasu)/i.test(a)
    || /(?:przycisk|rozwiązania?\s+(?:sytuacji\s+)?patowej|rozwiązania?\s+impasu)[^.!?]{0,180}(?:oddał|dał|zapewnił|dała|zapewniła|przekazał|przekazała)[^.!?]*(?:władz|kontrol)/i.test(a);

  const przyciskJakoWylacznaPrzyczyna =
    /(?:przycisk|rozwiązania?\s+(?:sytuacji\s+)?patowej|rozwiązania?\s+impasu)[^.!?]{0,140}(?:spowodował|spowodowało|doprowadził|doprowadziło|dał|dała|zapewnił|zapewniła|umożliwił|umożliwiła|przekazał|przekazała)[^.!?]{0,100}(?:przejęcia|przejęcie|przejął|uzyskania\s+władzy|dania\s+władzy)/i.test(a);

  const przyciskJakoSzansaNaUcieczke =
    /(?:przycisk|rozwiązania?\s+(?:sytuacji\s+)?patowej|rozwiązania?\s+impasu)[^.!?]{0,180}(?:był|była|było|był[aą])[^.!?]{0,100}(?:szans|okazj|możliwoś|ucieczk)/i.test(a);

  const gladosJakoProjektantWheatleya =
    /glados[^.!?]{0,160}(?:zaprojektowała|stworzyła)[^.!?]{0,160}(?:wheatley|niestabil|zmniejsz|obniż)/i.test(a)
    || /wheatley[^.!?]{0,120}(?:zaprojektowany|stworzony)[^.!?]{0,120}(?:przez|przez samą)\s+glados/i.test(a);

  const celProjektuJakoZmniejszenieGlados =
    /wheatley[^.!?]{0,180}(?:zaprojektowany|stworzony)[^.!?]{0,180}(?:zmniejsz|obniż|obniz)[^.!?]*(?:inteligenc|iq)/i.test(a)
    || /(?:zaprojektowany|stworzony)[^.!?]{0,180}(?:po to|aby|żeby|by)[^.!?]{0,100}(?:zmniejsz|obniż|obniz)[^.!?]*(?:inteligenc|iq)[^.!?]{0,120}\bwheatley\b/i.test(a);

  const przypisujeObnizenieJakoPrzyczyne =
    /(?:przejął|przejąć|przej[aą]ł|kontrolę|władzę)[^.!?]{0,180}(?:zmniejsz|obniż|obniz)[^.!?]*(?:inteligenc|iq)/i.test(a)
    || /(?:zmniejsz|obniż|obniz)[^.!?]*(?:inteligenc|iq)[^.!?]{0,180}(?:przejął|przejąć|kontrolę|władzę)/i.test(a);

  const rdzenJakoPrzyczynaPrzejecia =
    /(?:przejął|przejąć|przej[aą]ł|kontrolę|władzę)[^.!?]{0,180}(?:bezsensown|bezsensu|osłabić|osłabienie|zmniejsz|obniż)[^.!?]*(?:rdze|inteligenc)/i.test(a);

  const twierdziZeGladosBylaWylaczona =
    /glados[^.!?]{0,100}(?:była|byla|została|zostala)\s+całkowicie\s+wyłączon/i.test(a);

  const unsupported = [];
  if (przyciskJakoSzansaNaUcieczke) unsupported.push('przycisk rozwiązania impasu błędnie przedstawiono jako szansę Wheatleya na ucieczkę');
  if (gladosJakoProjektantWheatleya) unsupported.push('GLaDOS błędnie przypisano zaprojektowanie lub stworzenie Wheatleya');
  if (celProjektuJakoZmniejszenieGlados) unsupported.push('cel projektu Wheatleya błędnie opisano jako bezpośrednie zmniejszanie inteligencji GLaDOS');
  if (przyciskJakoBezposredniaPrzyczyna || przyciskJakoWylacznaPrzyczyna) unsupported.push('przycisk rozwiązania impasu błędnie przedstawiono jako bezpośrednią przyczynę uzyskania władzy');
  if (przypisujeObnizenieJakoPrzyczyne) unsupported.push('obniżenie inteligencji GLaDOS błędnie przedstawiono jako przyczynę przejęcia kontroli');
  if (rdzenJakoPrzyczynaPrzejecia) unsupported.push('przeznaczenie rdzenia Wheatleya błędnie przedstawiono jako przyczynę przejęcia kontroli');
  if (twierdziZeGladosBylaWylaczona) unsupported.push('GLaDOS błędnie opisana jako całkowicie wyłączona');

  return { ok: unsupported.length === 0, unsupported };
}

function sprawdzTwardeFaktyOdpowiedzi(odpowiedz, dane, pytanie = '') {
  const questionTokens = new Set(wyodrebnijTwardeTokeny(pytanie));
  const answerTokens = wyodrebnijTwardeTokeny(odpowiedz).filter(token => !questionTokens.has(token));
  const rawEvidence = String(dane || '');
  const parsedSources = parseEvidenceBlocks(rawEvidence);
  const referenceText = parsedSources.length
    ? parsedSources.map(source => source.content).filter(Boolean).join('\n')
    : removeLeadingSourceMetadataNoise(rawEvidence);
  const refs = referenceText.toLocaleLowerCase('pl-PL')
    .replace(/[\u00a0\u2009\u202f]/g, ' ').replace(/\s+/g, ' ').replace(/,/g, '.');
  const referenceTokens = new Set(wyodrebnijTwardeTokeny(refs));
  const unsupported = answerTokens.filter(token => !zawieraTokenTwardy(refs, token) && !referenceTokens.has(token));
  const contextCheck = sprawdzZgodnoscKontekstuGry(odpowiedz, pytanie);
  const contextUnsupported = contextCheck.conflicting.map(name => `odpowiedź wprowadza inną grę/uniwersum: ${name}`);
  const loreCheck = sprawdzSpojnoscLorePortal2(odpowiedz, pytanie);
  return {
    ok: unsupported.length === 0 && contextCheck.ok && loreCheck.ok,
    unsupported: [...unsupported, ...contextUnsupported, ...loreCheck.unsupported].slice(0, 8),
    checked: answerTokens,
    conflictingGames: contextCheck.conflicting,
    diagnostics: {
      hardTokenCheck: { ok: unsupported.length === 0, unsupported, checked: answerTokens },
      gameContextCheck: { ok: contextCheck.ok, conflicting: contextCheck.conflicting },
      portal2LoreCheck: { ok: loreCheck.ok, unsupported: loreCheck.unsupported },
    },
  };
}

function sprawdzFormatOdpowiedzi(odpowiedz, { maxZdania = 2, maxZnakow = 900 } = {}) {
  const text = String(odpowiedz || '').trim();
  if (!text) return { ok: false, reason: 'pusta odpowiedź' };
  if (text.length > maxZnakow) return { ok: false, reason: 'odpowiedź jest zbyt długa' };
  if (/https?:\/\//i.test(text)) return { ok: false, reason: 'odpowiedź zawiera URL' };
  const normalized = maskSentenceAbbreviations(text);
  const sentenceCount = (normalized.match(/[.!?]+(?=\s|$)/g) || []).length;
  if (sentenceCount > maxZdania) return { ok: false, reason: `odpowiedź ma więcej niż ${maxZdania} zdania` };
  return { ok: true, reason: 'format poprawny' };
}

module.exports = {
  maskSentenceAbbreviations,
  normalizujTokenLiczbowy,
  wyodrebnijTwardeTokeny,
  sprawdzTwardeFaktyOdpowiedzi,
  sprawdzSpojnoscLorePortal2,
  sprawdzZgodnoscKontekstuGry,
  sprawdzFormatOdpowiedzi,
};
