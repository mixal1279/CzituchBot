'use strict';

const SLOT_PATTERNS = Object.freeze({
  why: /\b(dlaczego|czemu|z jakiego powodu|why|how come)\b/i,
  how: /\b(jak|w jaki sposób|how)\b/i,
  when: /\b(kiedy|w którym roku|w jakim roku|when)\b/i,
  where: /\b(gdzie|dokąd|skąd|where)\b/i,
  who: /\b(kto|kim|czyj|who|whose)\b/i,
  quantity: /\b(ile|jak dużo|jak wiele|how many|how much)\b/i,
  comparison: /\b(czym\s+(?:się\s+)?różni|czym\s+różni\s+się|różnica|porównaj|lepszy|gorszy|vs\.?|versus|difference|compare)\b/i,
  steps: /\b(jak zrobić|jak wykonać|jak zdobyć|jak przejść|jak naprawić|jak użyć|instrukcja|krok po kroku|how to|walkthrough)\b/i,
  outcome: /\b(co\s+(?:się\s+)?stało(?:\s+się)?|co dalej|jaki był skutek|konsekw\p{L}*|what happened|what happened next)\b/iu,
  relationship: /\b(relacj\p{L}*|związek|przyjaźń|wróg|sojusz|relationship|friend|enemy|alliance)\b/iu,
});
const INTENT_REQUIREMENTS = Object.freeze({ lore: ['entity_context'], gameplay: ['steps'], hltb: ['quantity'], weather: ['location'], web_fact: ['entity_context'] });
function normalize(value) { return String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}%]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function buildAnswerPlan(question, routing = {}) {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  const slots = new Set(INTENT_REQUIREMENTS[routing.intent] || []);
  const matched = [];
  for (const [slot, re] of Object.entries(SLOT_PATTERNS)) if (re.test(q)) { slots.add(slot); matched.push(slot); }
  if (routing.is_lore) slots.add('entity_context');
  if (routing.is_gameplay) slots.add('steps');
  if (slots.has('why')) slots.add('causal_explanation');
  const clauses = q.split(/\s+(?=(?:i|oraz|a także|natomiast)\s+(?:jak|dlaczego|czemu|kiedy|gdzie|ile|czy|kto|kim|co|czym|jaki|jaka|jakie)\b)/iu).map(x => x.trim()).filter(Boolean).slice(0, 4);
  const requirements = [...slots].map(slot => ({ id: slot, required: true, reason: matched.includes(slot) ? 'question_signal' : 'intent_contract' }));
  return { version: 26, question: q, intent: routing.intent || 'conversation', entity: routing.entity || routing.resolved_entity?.name || null, game: routing.game || routing.resolved_entity?.game || null, requirements, clauses, complexity: requirements.length >= 4 || clauses.length >= 2 ? 'high' : requirements.length >= 2 ? 'medium' : 'low', instruction: requirements.length ? 'Odpowiedź musi pokryć: ' + requirements.map(r => r.id).join(', ') + '. Nie dodawaj niepotwierdzonych faktów.' : 'Odpowiedz bezpośrednio i nie dodawaj niepotwierdzonych faktów.' };
}
function extractAnswerSignals(answer) {
  const text = normalize(answer);
  const where = /\b(w|we|na|do|z|ze)\s+[a-ząćęłńóśźż0-9-]+/.test(text);
  return {
    why: /\b(dlaczego|czemu|powod|poniewaz|bo|because|because of|due to)\b/.test(text),
    how: /\b(nalezy|trzeba|mozna|sposob|krok|najpierw|potem|nastepnie|first|then|step)\b/.test(text),
    when: /\b(?:19|20)\d{2}\b|\b(?:w|od|do)\s+(?:styczniu|lutym|marcu|kwietniu|maju|czerwcu|lipcu|sierpniu|wrzesniu|pazdzierniku|listopadzie|grudniu)\b/.test(text),
    where,
    location: where,
    who: /\b(byl|byla|bylo|byli|jest|sa|jako|osoba|postac|gracz|autor|tworca|bohater)\b/.test(text),
    quantity: /\b\d+(?:[.,]\d+)?\s*(?:godzin|godz|h|min|sekund|dni|lat|%|gb|mb|tb|zł|pln|usd|eur)?\b/.test(text),
    comparison: /\b(roznic|rozni|wiecej|mniej|leps|gors|natomiast|podobn|vs|versus|z kolei)\b/.test(text),
    steps: /\b(najpierw|potem|nastepnie|krok|musisz|trzeba|nalezy|wykonaj|zdobadz|przejdz|uzyj)\b/.test(text),
    outcome: /\b(wynik|skutek|konsekwenc|ostatecznie|pozniej|potem|nastepnie|umar|zgina|zostal|zostala)\b/.test(text),
    relationship: /\b(?:relacj\p{L}*|zwiazk\p{L}*|przyjac\p{L}*|wrog\p{L}*|sojusz\p{L}*|zdrad\p{L}*|partner\p{L}*)\b/u.test(text),
    entity_context: text.length > 0,
    causal_explanation: /\b(dlatego|poniewaz|bo|powodem|przyczyn|wskutek|because|therefore|led to)\b/.test(text),
  };
}
function assessAnswerCompleteness(answer, plan) {
  if (!plan || !Array.isArray(plan.requirements) || !plan.requirements.length) return { ok: true, score: 1, missing: [], checked: [] };
  const signals = extractAnswerSignals(answer), checked = [], missing = [];
  for (const requirement of plan.requirements) {
    const id = requirement?.id;
    if (!id) continue;
    const ok = id === 'entity_context' ? Boolean(String(answer || '').trim()) : Boolean(signals[id]);
    checked.push({ id, ok });
    if (!ok) missing.push(id);
  }
  const score = checked.length ? (checked.length - missing.length) / checked.length : 1;
  return { ok: missing.length === 0, score: Number(score.toFixed(3)), missing, checked };
}
module.exports = { buildAnswerPlan, extractAnswerSignals, assessAnswerCompleteness };
