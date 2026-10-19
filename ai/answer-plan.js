'use strict';

const SLOT_PATTERNS = Object.freeze({
  why: /\b(dlaczego|czemu|z jakiego powodu|why|how come)\b/i,
  // „Jak” samo w sobie nie oznacza instrukcji: rozróżniamy mechanizm działania od pytań o czas i procedurę.
  how: /\b(jak działa|jak funkcjonuje|w jaki sposób działa|na czym polega|how does .{1,80} work|how do .{1,80} work)\b/i,
  when: /\b(kiedy|w którym roku|w jakim roku|when)\b/i,
  where: /\b(gdzie|dokąd|skąd|where)\b/i,
  who: /\b(kto|kim|czyj|who|whose)\b/i,
  quantity: /\b(ile|jak długo|jak dlugo|jak dużo|jak wiele|how long|how many|how much)\b/i,
  comparison: /\b(czym\s+(?:się\s+)?różni|czym\s+różni\s+się|różnica|porównaj|lepszy|gorszy|vs\.?|versus|difference|compare)\b/i,
  steps: /\b(jak zrobić|jak wykonać|jak zdobyć|jak przejść|jak ukończyć|jak ukonczyc|jak pokonać|jak znaleźć|jak znalezc|jak odblokować|jak odblokowac|jak aktywować|jak aktywowac|jak naprawić|jak naprawic|jak użyć|jak uzyc|instrukcja|krok po kroku|how to|walkthrough)\b/i,
  outcome: /\b(co\s+(?:się\s+)?stało(?:\s+się)?|co dalej|jaki był skutek|konsekw\p{L}*|what happened|what happened next)\b/iu,
  relationship: /\b(relacj\p{L}*|związek|przyjaźń|wróg|sojusz|relationship|friend|enemy|alliance)\b/iu,
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
    .replace(/ł/g, 'l')
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
  // Procedural questions satisfy the broad how-intent as well as the steps slot.
  if (slots.has('steps')) slots.add('how');
  if (slots.has('why')) {
    slots.add('causal_explanation');
    // Dowód przyczyny jest wymaganiem wewnętrznego kontraktu, nie osobnym sygnałem odpowiedzi.
  }
  // Pytania przyczynowe wymagają osobnego dowodu dla faktu i dla przyczyny.
  // Sam fakt, że wydarzenie A poprzedza B, nie jest dowodem relacji A -> B.
  const causalQuestion = slots.has('why');

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
  const where = /\b(?:w(?!\s+(?:wyniku|rezultacie|celu|zamian|zwiazku|odpowiedni\w*|okreslon\w*|miejsc\w*))|we(?!\s+wzgledu)|na(?!\s+(?:skutek|podstawie|poczatku|koncu))|do(?!\s+tego)|z(?!\s+(?:powodu|przyczyny|uwagi|tego))|ze(?!\s+wzgledu))\s+[a-z0-9-]+/.test(text);
  const causalMarker = /\b(dlaczego|czemu|powod|z powodu|z przyczyny|ze wzgledu na|z uwagi na|poniewaz|dlatego|gdyz|bo|w zamian|w wyniku|w rezultacie|dzieki|because|because of|due to)\b/.exec(text)?.[0] || '';
  // Instrukcja planu każe napisać „źródła nie potwierdzają przyczyny”, gdy materiał
  // jej nie podaje. Taka uczciwa odpowiedź spełnia wymaganie „dlaczego”.
  const causeUnconfirmed = /\b(?:zrodla|zrodlo|materialy|dane)\b.{0,60}\bnie\s+(?:potwierdza\w*|wskazuja|podaja|precyzuja|wyjasniaja)\b|\bbrak\s+potwierdzon\w*\s+(?:przyczyn|powod)\w*|\bnie\s+wynika\b.{0,40}\b(?:przyczyn|powod|dlaczego)\w*/.test(text);
  const procedural = /\b(nalezy|trzeba|mozna|sposob|krok|najpierw|potem|nastepnie|first|then|step|wystarczy|uzyj|uzywaj|wykorzystaj|skorzystaj|wybierz|zdobadz|znajdz|idz|wejdz|pokonaj|unikaj|zabij|atakuj|zbuduj|stworz|wez|kup|otworz|podejdz|poczekaj)\b/.exec(text)?.[0] || '';
  const mechanism = /\b(dziala|funkcjonuje|polega|mechanizm|umozliw\w*|pozwala)\b/.exec(text)?.[0] || '';
  const relationshipMarker = /\b(?:relacj\p{L}*|zwiazk\p{L}*|przyjac\p{L}*|wrog\p{L}*|sojusz\p{L}*|zdrad\p{L}*|partner\p{L}*)\b/u.exec(text)?.[0] || '';

  return {
    why: (Boolean(causalMarker) && hasMeaningfulTail(text, causalMarker)) || causeUnconfirmed,
    how: Boolean(mechanism || procedural) && hasMeaningfulTail(text, mechanism || procedural),
    when: /\b(?:1\d{3}|20\d{2})\b|\b(?:po|przed|podczas|w trakcie|pod koniec|na poczatku)\s+\w+|\b(?:w|od|do)\s+(?:styczniu|lutym|marcu|kwietniu|maju|czerwcu|lipcu|sierpniu|wrzesniu|pazdzierniku|listopadzie|grudniu)\b|\b(?:wtedy|nastepnie|pozniej|wcześniej|wczesniej)\b/.test(text),
    where,
    location: where,
    // Po polsku typowa definicja to „X to Y” („Astarion to wampirzy łotrzyk”), nie tylko „X jest Y”.
    who: (/\b(?:jest|sa|byl|byla|byli|jako|osoba|postac|gracz|autor|tworca|bohater)\b/.test(text)
      || /\b\w{3,}\s+to\s+\w{4,}/.test(text)
      || /\b(?:jeden|jedna|jedno)\s+z\b/.test(text)
      || /\b(?:towarzysz\w*|czlonek|czlonkini|przywodc\w*|dowodc\w*|zalozyciel\w*|wlasciciel\w*|antagonist\w*|protagonist\w*|zloczyn\w*|sojusznik\w*)\b/.test(text))
      && !/^\s*(?:to|jest)\s+(?:posta[cć]|osoba)\b/.test(text),
    quantity: /\b\d+(?:[.,]\d+)?\s*(?:godzin|godz|h|min|sekund|dni|lat|%|gb|mb|tb|zl|pln|usd|eur)?\b/.test(text),
    comparison: /\b(roznic\w*|rozni\w*|wiecej|mniej|leps\w*|gors\w*|natomiast|podobn\w*|vs|versus|z kolei|w przeciwienstwie|podczas gdy|tymczasem|zas|odmienn\w*|bardziej)\b/.test(text)
      || /\b\w{3,}iejsz\w*\b|\b\w{3,}sz[aeyi]\b/.test(text),
    steps: Boolean(procedural) && hasMeaningfulTail(text, procedural),
    outcome: /\b(wynik\w*|skutek|skutk\w*|konsekwenc\w*|ostatecznie|pozniej|potem|nastepnie|umar\w*|zgin\w*|zostal\w*)\b/.test(text)
      && text.split(/\s+/).length >= 4,
    relationship: Boolean(relationshipMarker)
      && /\b(?:wspolprac|wspolpracy|konflikt|przyjazn|zauf|zdrad|sojusz|wrog|partner|lacz|dziel)\p{L}*/u.test(text),
    entity_context: text.length > 0,
    causal_explanation: (Boolean(causalMarker) && hasMeaningfulTail(text, causalMarker)) || causeUnconfirmed,
  };
}

function containsRequiredEntityContext(answer, plan) {
  const target = normalize(plan?.entity || plan?.game || '');
  if (target.length < 3) return Boolean(String(answer || '').trim());
  return normalize(answer).includes(target);
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
      ? containsRequiredEntityContext(answer, plan)
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
