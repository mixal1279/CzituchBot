'use strict';

const STOP = new Set([
  'czy','jak','jaki','jaka','jakie','co','czym','kto','kim','kiedy','gdzie','ile',
  'dlaczego','czemu','jest','są','to','ten','ta','te','do','na','w','we','z','ze',
  'o','od','po','dla','i','oraz','a','czyli','się','ma','mają','miał','była','było',
]);

function norm(text) {
  return String(text || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tokens(text) {
  return [...new Set((norm(text).match(/[\p{L}\p{N}]{4,}/gu) || []).filter(t => !STOP.has(t)))];
}

function ocenJakoscOdpowiedzi(question, answer, routing = {}, profile = 'simple') {
  const q = String(question || '').trim();
  const a = String(answer || '').replace(/\s+/g, ' ').trim();
  const wymagajacy = ['lore', 'gameplay', 'timeline', 'web_fact'].includes(profile);
  if (!wymagajacy) return { ok: true, score: 1, issues: [] };

  const issues = [];
  if (a.length < (profile === 'lore' || profile === 'gameplay' ? 70 : 35)) issues.push('odpowiedź jest zbyt krótka');
  if (!/[.!?]$/.test(a)) issues.push('odpowiedź nie kończy się pełnym zdaniem');

  const qTokens = tokens(q);
  const aNorm = norm(a);
  const entity = routing?.resolved_entity?.name || routing?.entity || routing?.game || '';
  const entityTokens = tokens(entity).filter(t => t.length >= 5);
  const overlap = [...new Set([...qTokens, ...entityTokens])].filter(t => aNorm.includes(t));
  if (profile === 'lore' && (entityTokens.length || qTokens.length) && overlap.length === 0) {
    issues.push('odpowiedź nie odnosi się wprost do rozpoznanej encji ani słów kluczowych pytania');
  }

  const refusal = /^(?:nie wiem|nie jestem pewien|nie mam wystarczających danych|nie mogę odpowiedzieć|brakuje danych)\b/i.test(a);
  if (refusal && profile !== 'chat') issues.push('odpowiedź jest ogólną odmową');

  const score = Math.max(0, 1 - issues.length * 0.3);
  return { ok: issues.length === 0, score, issues };
}

module.exports = { norm, tokens, ocenJakoscOdpowiedzi };
