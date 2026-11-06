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

function oznaczUzycieHistorii(ostatnieUzycie, klucz, teraz = Date.now()) {
  if (!ostatnieUzycie || typeof ostatnieUzycie !== 'object' || Array.isArray(ostatnieUzycie)) return false;
  const key = String(klucz || '').trim();
  if (!key) return false;
  ostatnieUzycie[key] = Number.isFinite(teraz) ? teraz : Date.now();
  return true;
}

function ograniczHistorieRozmow(historie, ostatnieUzycie, limit = 500) {
  if (!historie || typeof historie !== 'object' || Array.isArray(historie)) return [];
  if (!ostatnieUzycie || typeof ostatnieUzycie !== 'object' || Array.isArray(ostatnieUzycie)) return [];
  const max = Number.isSafeInteger(limit) && limit >= 0 ? limit : 500;
  const klucze = Object.keys(historie);
  if (klucze.length <= max) return [];
  klucze.sort((a, b) => (Number(ostatnieUzycie[a]) || 0) - (Number(ostatnieUzycie[b]) || 0));
  const usuniete = klucze.slice(0, klucze.length - max);
  for (const key of usuniete) {
    delete historie[key];
    delete ostatnieUzycie[key];
  }
  return usuniete;
}

module.exports = { normalizujStrukturalnePodsumowanie, parsujStrukturalnePodsumowanie, oznaczUzycieHistorii, ograniczHistorieRozmow };
