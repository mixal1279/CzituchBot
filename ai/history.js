'use strict';

function normalizujStrukturalnePodsumowanie(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cleanList = key => Array.isArray(value[key])
    ? value[key].filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().slice(0, 180)).slice(0, 8)
    : [];
  const recent = typeof value.recent_context === 'string' ? value.recent_context.trim().slice(0, 500) : '';
  const result = {
    entities: cleanList('entities'),
    preferences: cleanList('preferences'),
    decisions: cleanList('decisions'),
    open_questions: cleanList('open_questions'),
    recent_context: recent,
  };
  if (!result.entities.length && !result.preferences.length && !result.decisions.length && !result.open_questions.length && !result.recent_context) return null;
  const sections = [];
  if (result.entities.length) sections.push(`Encje: ${result.entities.join(', ')}`);
  if (result.preferences.length) sections.push(`Preferencje: ${result.preferences.join('; ')}`);
  if (result.decisions.length) sections.push(`Ustalenia: ${result.decisions.join('; ')}`);
  if (result.open_questions.length) sections.push(`Otwarte pytania: ${result.open_questions.join('; ')}`);
  if (result.recent_context) sections.push(`Kontekst: ${result.recent_context}`);
  return sections.join(' | ').slice(0, 1400);
}
function parsujStrukturalnePodsumowanie(text) {
  try { return normalizujStrukturalnePodsumowanie(JSON.parse(String(text || '').trim())); }
  catch (_) { return null; }
}


function zbudujKluczHistorii(platforma, kanal, userId) {
  const normalizuj = (value, fallback, lowercase = true) => {
    let result = String(value ?? '').trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128);
    if (lowercase) result = result.toLocaleLowerCase('pl-PL');
    return result || fallback;
  };
  return [
    normalizuj(platforma, 'unknown'),
    normalizuj(kanal, 'brak-kanalu'),
    // Identyfikatory YouTube są case-sensitive; nie sprowadzaj ich do lowercase.
    normalizuj(userId, 'unknown', false),
  ].join(':');
}

const NIEBEZPIECZNE_KLUCZE = new Set(['__proto__', 'prototype', 'constructor']);

function czyBezpiecznySlownik(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value === Object.prototype) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (_) {
    return false;
  }
}

function oznaczUzycieHistorii(ostatnieUzycie, klucz, teraz = Date.now()) {
  if (!czyBezpiecznySlownik(ostatnieUzycie)) return false;
  const key = String(klucz || '').trim();
  if (!key || NIEBEZPIECZNE_KLUCZE.has(key)) return false;
  try {
    Object.defineProperty(ostatnieUzycie, key, {
      value: Number.isFinite(teraz) ? teraz : Date.now(),
      writable: true,
      configurable: true,
      enumerable: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function ograniczHistorieRozmow(historie, ostatnieUzycie, limit = 500) {
  if (!czyBezpiecznySlownik(historie) || !czyBezpiecznySlownik(ostatnieUzycie)) return [];

  // Usuń niebezpieczne własne klucze JSON bez przypisywania ich do prototypu.
  for (const key of NIEBEZPIECZNE_KLUCZE) {
    Reflect.deleteProperty(historie, key);
    Reflect.deleteProperty(ostatnieUzycie, key);
  }

  const max = Number.isSafeInteger(limit) && limit >= 0 ? limit : 500;
  const klucze = Object.keys(historie);
  if (klucze.length <= max) return [];
  klucze.sort((a, b) => (Number(ostatnieUzycie[a]) || 0) - (Number(ostatnieUzycie[b]) || 0));
  const kandydaci = klucze.slice(0, klucze.length - max);
  const usuniete = [];
  for (const key of kandydaci) {
    const usunietoHistorie = Reflect.deleteProperty(historie, key);
    const usunietoUzycie = Reflect.deleteProperty(ostatnieUzycie, key);
    if (usunietoHistorie || usunietoUzycie) usuniete.push(key);
  }
  return usuniete;
}

module.exports = { normalizujStrukturalnePodsumowanie, parsujStrukturalnePodsumowanie, oznaczUzycieHistorii, ograniczHistorieRozmow, zbudujKluczHistorii };
