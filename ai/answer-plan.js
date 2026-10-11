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
  relationship: /(?:relacj|związk|przyjaź|wróg|sojusz|relationship|friend|enemy|alliance)/iu,
});
const INTENT_REQUIREMENTS = Object.freeze({
  lore: ['entity_context'],
  gameplay: ['steps'],
  hltb: ['quantity'],
  weather: ['location'],
  web_fact: ['entity_context'],
});

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAnswerPlan(question, routing = {}) {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  const slots = new Set(INTENT_REQUIREMENTS[routing.intent] || []);
  const matched = [];
  for (const [slot, re] of Object.entries(SLOT_PATTERNS)) {
    if (re.test(q)) {
      slots.add(slot);
      matched.push(slot);
    }
  }
  if (routing.is_lore) slots.add('entity_context');
  if (routing.is_gameplay) slots.add('steps');
  if (slots.has('why')) {
    slots.add('causal_explanation');
    // Dowód przyczyny jest wymaganiem wewnętrznego kontraktu, nie osobnym sygnałem odpowiedzi.
  }
  // Pytania przyczynowe wymagają osobnego dowodu dla faktu i dla przyczyny.
  // Sam fakt, że wydarzenie A poprzedza B, nie jest dowodem relacji A -> B.
  const causalQuestion = slots.has('why');
  const quantityMayBeVariable = slots.has('quantity')
    && /\b(?:ile|jak długo|how long)\b/i.test(q)
    && /\b(?:trwa|trwać|trwac|duration|lasts?|take[s]?)\b/i.test(q);

  const clauses = q.split(
    /\s+(?=(?:i|oraz|a także|natomiast)\s+(?:jak|dlaczego|czemu|kiedy|gdzie|ile|czy|kto|kim|co|czym|jaki|jaka|jakie)\b)/iu,
  ).map(x => x.trim()).filter(Boolean).slice(0, 4);

  const requirements = [...slots].map(slot => ({
    id: slot,
    required: true,
    reason: matched.includes(slot) ? 'question_signal' : 'intent_contract',
  }));

  return {
    version: 26,
    question: q,
    intent: routing.intent || 'conversation',
    entity: routing.entity || routing.resolved_entity?.name || null,
    game: routing.game || routing.resolved_entity?.game || null,
    requirements,
    clauses,
    complexity: requirements.length >= 4 || clauses.length >= 2
      ? 'high'
      : requirements.length >= 2 ? 'medium' : 'low',
    causalQuestion,
    quantityMayBeVariable,
    instruction: requirements.length
      ? 'Odpowiedź musi pokryć: ' + requirements.map(r => r.id).join(', ') + '. Każde zdanie faktograficzne ma być atomowym claimem opartym na jednym zweryfikowanym fragmencie evidence. Dla pytania „dlaczego/czemu” oddziel fakt od przyczyny: podaj przyczynę tylko wtedy, gdy konkretny evidence quote wyraźnie łączy przyczynę ze skutkiem. Nie traktuj kolejności wydarzeń jako przyczynowości. Jeśli brak takiego dowodu, powiedz wprost, że źródła nie potwierdzają przyczyny.'
      : 'Odpowiedz bezpośrednio i nie dodawaj niepotwierdzonych faktów.',
  };
}

function hasMeaningfulTail(text, marker) {
  const index = text.indexOf(marker);
  if (index < 0) return false;
  const tail = text.slice(index + marker.length).trim();
  return tail.split(/\s+/).filter(Boolean).length >= 2;
}

function extractAnswerSignals(answer) {
  const text = normalize(answer);
  const where = /\b(w|we|na|do|z|ze)\s+(?!\d)[a-ząćęłńóśźż0-9-]+/.test(text)
    && !/\b(?:w|we|na|do)\s+(?:odpowiednim|okreslonym|okreslonej|miejscu|miejsca)\b/.test(text);
  const causalMarker = /\b(dlaczego|czemu|powod|poniewaz|bo|because|because of|due to)\b/.exec(text)?.[0] || '';
  const procedural = /\b(nalezy|trzeba|mozna|sposob|krok|najpierw|potem|nastepnie|uzyj|atakuj|wykorzystaj|unikaj|poczekaj|wyposaz|rzuc|cast|use|attack|avoid|equip|first|then|step)\b/.exec(text)?.[0] || '';
  const relationshipMarker = /\b(?:relacj\p{L}*|zwiazk\p{L}*|przyjac\p{L}*|towarzysz\p{L}*|wrog\p{L}*|sojusz\p{L}*|romans\p{L}*|zdrad\p{L}*|partner\p{L}*)\b/u.exec(text)?.[0] || '';

  return {
    why: Boolean(causalMarker) && hasMeaningfulTail(text, causalMarker),
    how: Boolean(procedural) && hasMeaningfulTail(text, procedural),
    when: /\b(?:19|20)\d{2}\b|\b(?:w|od|do)\s+(?:styczniu|lutym|marcu|kwietniu|maju|czerwcu|lipcu|sierpniu|wrzesniu|pazdzierniku|listopadzie|grudniu)\b|\b(?:wtedy|nastepnie|pozniej|wczesniej)\b|\bpo\s+(?:wydarzeniach|zakonczeniu|questach|zadaniach|watku)\b/.test(text),
    where,
    location: where,
    who: /\b(?:jest|sa|byl|byla|byli|jako|osoba|postac|gracz|autor|tworca|bohater)\b/.test(text)
      && !/^\s*(?:to|jest)\s+(?:posta[cć]|osoba)\b/.test(text),
    quantity: /\b\d+(?:[.,]\d+)?\s*(?:godzin|godz|h|min|sekund|dni|lat|%|gb|mb|tb|zł|pln|usd|eur)?\b/.test(text),
    quantityVariable: /\b(?:nie ma (?:jednego|stalego|okreslonego)|nie da sie (?:tego )?okreslic|zalezy od|moze trwac roznie|czas jest rozny|to zalezy|depends on|varies|no fixed|not fixed)\b/.test(text),
    comparison: /\b(roznic|rozni|wiecej|mniej|leps|gors|natomiast|podobn|vs|versus|z kolei)\b/.test(text)
      && /\b(?:roznic|rozni|natomiast|z kolei|wiecej|mniej|leps|gors)\b/.test(text),
    steps: Boolean(procedural) && hasMeaningfulTail(text, procedural),
    outcome: /\b(wynik|skutek|konsekwenc|ostatecznie|pozniej|potem|nastepnie|umar\w*|zgin\w*|gin\w*|zabij\w*|smier\w*|zostal\w*|zostaj\w*)\b/.test(text)
      && text.split(/\s+/).length >= 4,
    relationship: Boolean(relationshipMarker)
      && /\b(?:wspolprac|konflikt|przyjazn|zauf|zdrad|sojusz|wrog|partner|towarzysz|romans|lacz|dziel)\p{L}*/u.test(text),
    entity_context: text.length > 0,
    causal_explanation: Boolean(causalMarker) && hasMeaningfulTail(text, causalMarker),
  };
}

function assessAnswerCompleteness(answer, plan) {
  if (!plan || !Array.isArray(plan.requirements) || !plan.requirements.length) {
    return { ok: true, score: 1, missing: [], checked: [] };
  }
  const signals = extractAnswerSignals(answer);
  const checked = [];
  const missing = [];

  for (const requirement of plan.requirements) {
    const id = requirement?.id;
    if (!id) continue;
    const ok = id === 'entity_context'
      ? Boolean(String(answer || '').trim())
      : id === 'quantity' && plan.quantityMayBeVariable
        ? Boolean(signals.quantity || signals.quantityVariable)
        : Boolean(signals[id]);
    checked.push({ id, ok });
    if (!ok) missing.push(id);
  }

  const score = checked.length ? (checked.length - missing.length) / checked.length : 1;
  return {
    ok: missing.length === 0,
    score: Number(score.toFixed(3)),
    missing,
    checked,
  };
}

module.exports = { buildAnswerPlan, extractAnswerSignals, assessAnswerCompleteness };
