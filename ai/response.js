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

function sprawdzSpojnoscLorePortal2(odpowiedz, pytanie) {
  const q = String(pytanie || '').toLocaleLowerCase('pl-PL');
  const a = String(odpowiedz || '').toLocaleLowerCase('pl-PL');
  const portal = /\bportal\s*2\b|\bwheatley\b|\bglados\b|\bchell\b|\baperture\s+science\b/i.test(q);
  if (!portal) return { ok: true, unsupported: [] };

  const pytaOPrzejecie = /\bwheatley\b/i.test(q)
    && /(?:^|[^\p{L}])(?:przejął|przejęła|przejęcie|przej[aą]ł|kontrolę|władzę|wladze)(?=$|[^\p{L}])/iu.test(q);
  if (!pytaOPrzejecie) return { ok: true, unsupported: [] };

  // Kluczowy fakt przyczynowy: transfer rdzenia doprowadził do umieszczenia
  // Wheatleya w ciele GLaDOS. Sam Stalemate Resolution Button jedynie uruchamia
  // transfer; nie "daje" Wheatleyowi władzy jako odrębna przyczyna.
  const maMechanizmTransferu = [
    /transfer(?:ze|u)?\s+(?:rdzen|rdzeni|ciał|ciała)/i,
    /transfer(?:ze|u)?[^.!?]{0,120}\bwheatley\b[^.!?]{0,120}\bglados\b/i,
    /\bwheatley\b[^.!?]{0,160}(?:został|zostaje|została)\s+(?:umieszczon|podłączon|przeniesion)[^.!?]{0,100}\bglados\b/i,
    /\bwheatley\b[^.!?]{0,160}(?:przejął|otrzymał)\s+(?:ciało|body)\s+glados/i,
    /zamian(?:a|ę|ie)\s+ciał[^.!?]{0,120}\bwheatley\b/i,
  ].some(re => re.test(a));

  const przyciskJakoBezposredniaPrzyczyna =
    /(?:przejął|przejąć|przej[aą]ł|zdobył|uzyskał|dostał|otrzymał)[^.!?]{0,180}(?:bo|ponieważ|dlatego|dzięki|przez)[^.!?]*(?:przycisk|rozwiązania?\s+(?:sytuacji\s+)?patowej|rozwiązania?\s+(?:sytuacji\s+)?impasu|rozwiązania?\s+impasu)/i.test(a)
    || /(?:przycisk|rozwiązania?\s+(?:sytuacji\s+)?patowej|rozwiązania?\s+(?:sytuacji\s+)?impasu|rozwiązania?\s+impasu)[^.!?]{0,180}(?:oddał|dał|zapewnił|dała|zapewniła|przekazał|przekazała)[^.!?]*(?:władz|kontrol)/i.test(a);

  const przyciskJakoWylacznaPrzyczyna =
    /(?:przycisk|rozwiązania?\s+(?:sytuacji\s+)?patowej|rozwiązania?\s+(?:sytuacji\s+)?impasu|rozwiązania?\s+impasu)[^.!?]{0,100}(?:przejęcia|przejęcie|przejął|uzyskania\s+władzy|dania\s+władzy)/i.test(a);

  const przypisujeObnizenieJakoPrzyczyne =
    /(?:przejął|przejąć|przej[aą]ł|kontrolę|władzę)[^.!?]{0,180}(?:zmniejsz|obniż|obniz)[^.!?]*(?:inteligenc|iq)/i.test(a)
    || /(?:zmniejsz|obniż|obniz)[^.!?]*(?:inteligenc|iq)[^.!?]{0,180}(?:przejął|przejąć|kontrolę|władzę)/i.test(a);

  const rdzenJakoPrzyczynaPrzejecia =
    /(?:przejął|przejąć|przej[aą]ł|kontrolę|władzę)[^.!?]{0,180}(?:bezsensown|bezsensu|osłabić|osłabienie|zmniejsz|obniż)[^.!?]*(?:rdze|inteligenc)/i.test(a);

  const twierdziZeGladosBylaWylaczona =
    /glados[^.!?]{0,100}(?:była|byla|została|zostala)\s+(?:całkowicie\s+)?wyłączon/i.test(a);

  const przyciskJakoSzansaNaUcieczke = /(?:przycisk|rozwiązania?\\s+(?:sytuacji\\s+)?patowej|rozwiązania?\\s+impasu)[^.!?]{0,140}(?:był|byla|było|był[aą])[^.!?]{0,80}(?:szans|okazj|możliwoś|ucieczk)/i.test(a);
  const gladosJakoProjektantWheatleya = /glados[^.!?]{0,160}(?:zaprojektowała|zaprojektowała go|stworzyła|stworzyła go)[^.!?]{0,160}(?:wheatley|niestabil|zmniejsz|obniż)/i.test(a) || /wheatley[^.!?]{0,120}(?:zaprojektowany|stworzony)[^.!?]{0,120}(?:przez|przez samą)\s+glados/i.test(a);
  const unsupported = [];
  if (przyciskJakoSzansaNaUcieczke) unsupported.push('odpowiedź przedstawia przycisk jako szansę Wheatleya na ucieczkę zamiast jako mechanizm uruchamiający transfer');
  if (gladosJakoProjektantWheatleya) unsupported.push('odpowiedź błędnie przypisuje GLaDOS zaprojektowanie lub stworzenie Wheatleya');
  if (/wheatley[^.!?]{0,180}(?:zaprojektowany|stworzony)[^.!?]{0,180}(?:zmniejsz|obniż)[^.!?]*(?:inteligenc|iq)/i.test(a)) unsupported.push('odpowiedź błędnie opisuje cel projektu Wheatleya jako bezpośrednie zmniejszanie inteligencji GLaDOS');
  if (!maMechanizmTransferu) unsupported.push('odpowiedź nie opisuje transferu rdzenia/zamiany ciał jako mechanizmu przejęcia kontroli przez Wheatleya');
  if (przyciskJakoBezposredniaPrzyczyna || przyciskJakoWylacznaPrzyczyna) {
    unsupported.push('odpowiedź przedstawia przycisk rozwiązania impasu jako bezpośrednią przyczynę uzyskania władzy przez Wheatleya');
  }
  if (przypisujeObnizenieJakoPrzyczyne) unsupported.push('odpowiedź miesza późniejsze obniżenie inteligencji GLaDOS z przyczyną przejęcia kontroli');
  if (rdzenJakoPrzyczynaPrzejecia) unsupported.push('odpowiedź miesza przeznaczenie rdzenia Wheatleya z przyczyną przejęcia kontroli');
  if (twierdziZeGladosBylaWylaczona) unsupported.push('odpowiedź upraszcza stan GLaDOS jako całkowite wyłączenie');

  return { ok: unsupported.length === 0, unsupported };
}

function sprawdzTwardeFaktyOdpowiedzi(odpowiedz, dane, pytanie = '') {
  const questionTokens = new Set(wyodrebnijTwardeTokeny(pytanie));
  const answerTokens = wyodrebnijTwardeTokeny(odpowiedz).filter(token => !questionTokens.has(token));
  const refs = String(dane || '').toLocaleLowerCase('pl-PL').replace(/,/g, '.');
  const unsupported = answerTokens.filter(token => !refs.includes(token));
  const contextCheck = sprawdzZgodnoscKontekstuGry(odpowiedz, pytanie);
  const contextUnsupported = contextCheck.conflicting.map(name => `odpowiedź wprowadza inną grę/uniwersum: ${name}`);
  const loreCheck = sprawdzSpojnoscLorePortal2(odpowiedz, pytanie);
  return {
    ok: unsupported.length === 0 && contextCheck.ok && loreCheck.ok,
    unsupported: [...unsupported, ...contextUnsupported, ...loreCheck.unsupported].slice(0, 8),
    checked: answerTokens,
    conflictingGames: contextCheck.conflicting,
  };
}

function sprawdzFormatOdpowiedzi(odpowiedz, { maxZdania = 2, maxZnakow = 900 } = {}) {
  const text = String(odpowiedz || '').trim();
  if (!text) return { ok: false, reason: 'pusta odpowiedź' };
  if (text.length > maxZnakow) return { ok: false, reason: 'odpowiedź jest zbyt długa' };
  if (/https?:\/\//i.test(text)) return { ok: false, reason: 'odpowiedź zawiera URL' };
  const normalized = text.replace(/\b(?:np|itp|itd|tj|tzn)\./gi, '§');
  const sentenceCount = (normalized.match(/[.!?]+(?=\s|$)/g) || []).length;
  if (sentenceCount > maxZdania) return { ok: false, reason: `odpowiedź ma więcej niż ${maxZdania} zdania` };
  return { ok: true, reason: 'format poprawny' };
}

module.exports = {
  normalizujTokenLiczbowy,
  wyodrebnijTwardeTokeny,
  sprawdzTwardeFaktyOdpowiedzi,
  sprawdzSpojnoscLorePortal2,
  sprawdzZgodnoscKontekstuGry,
  sprawdzFormatOdpowiedzi,
};
