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
  // Pytanie o gameplay nie zawsze wymaga kroków: czysto lokalizacyjne pytania
  // typu „gdzie znaleźć X”, „gdzie jest X” wymagają tylko lokalizacji (where),
  // a nie procedury. Wymaganie steps/how dla nich powoduje, że poprawna
  // odpowiedź „znajduje się w Y” zostaje odrzucona przez answer-judge
  // jako „brakujące kroki” (np. Elden Ring Wielki Miecz).
  const isGameplay = routing.is_gameplay === true || routing.intent === 'gameplay';
  const isLocationOnlyGameplay = isGameplay && slots.has('where')
    && !slots.has('why') && !/jak\s+(?:przej|zrobi|pokona|zdoby|odblokowa|rozwiąza|ukoncz|uzyc|użyc|aktywow|napraw)/i.test(q)
    && !/(?<![\p{L}\p{N}_])(?:walkthrough\p{L}*|solucj\p{L}*|poradnik\p{L}*|boss\p{L}*|quest\p{L}*|misj\p{L}*)(?![\p{L}\p{N}_])/iu.test(q);
  if (isGameplay && !isLocationOnlyGameplay) slots.add('steps');
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
    /(?<=[?;])\s+|\s+(?=(?:i|oraz|a także|natomiast)\s+(?:jak|dlaczego|czemu|kiedy|gdzie|ile|czy|kto|kim|co|czym|jaki|jaka|jakie)\b)/iu,
  ).map(x => x.trim()).filter(Boolean).slice(0, 4);
  if (clauses.length > 1) slots.add('clause_coverage');

  const requirements = [...slots].map(slot => ({
    id: slot,
    required: true,
    reason: slot === 'clause_coverage' ? 'multiple_question_clauses' : (matched.includes(slot) ? 'question_signal' : 'intent_contract'),
  }));
  const responseShapeGuidance = [
    slots.has('who')
      ? 'Dla pytań „kto/kim jest” zacznij od głównej tożsamości lub typu postaci, który źródło wyraźnie podaje; następnie podaj istotną rolę lub relację (np. towarzysz lub antagonista). Rasa i klasa są dodatkowymi atrybutami — nie mogą zastąpić głównej tożsamości. Nie dopisuj etykiety, której źródło nie potwierdza.'
      : '',
    slots.has('where')
      ? 'Dla pytań „gdzie” podaj nazwane miejsce lub region oraz konkretny punkt orientacyjny, jeśli źródła potwierdzają oba elementy; nie zastępuj nazw własnych ogólnym opisem.'
      : '',
    slots.has('when')
      ? 'Dla pytań „kiedy” nie zgaduj daty ani kolejności wydarzeń. Jeśli źródła nie podają dokładnego momentu, zaznacz to wprost i podaj tylko potwierdzony kontekst.'
      : '',
  ].filter(Boolean).join(' ');

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
      ? 'Odpowiedź musi pokryć: ' + requirements.map(r => r.id).join(', ') + '. Każde zdanie faktograficzne ma być atomowym claimem opartym na jednym zweryfikowanym fragmencie evidence. Dla pytania „dlaczego/czemu” oddziel fakt od przyczyny: podaj przyczynę tylko wtedy, gdy konkretny evidence quote wyraźnie łączy przyczynę ze skutkiem. Nie traktuj kolejności wydarzeń jako przyczynowości. Jeśli źródło jawnie podaje motyw lub cel działania (np. próbę upokorzenia), podaj ten motyw wprost i nie zastępuj go domniemaną przyczyną z sąsiednich zdań. Nie zamieniaj celu działania na przyczynę zdarzenia. Jeśli brak takiego dowodu, powiedz wprost, że źródła nie potwierdzają przyczyny.' + (responseShapeGuidance ? ' ' + responseShapeGuidance : '')
      : 'Odpowiedz bezpośrednio i nie dodawaj niepotwierdzonych faktów.' + (responseShapeGuidance ? ' ' + responseShapeGuidance : ''),
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
  const causalMarker = /\b(dlaczego|czemu|powod|z powodu|z przyczyny|ze wzgledu na|z uwagi na|poniewaz|dlatego|gdyz|bo|aby|zeby|w celu|na celu|w zamian|w wyniku|w rezultacie|dzieki|because|because of|due to)\b/.exec(text)?.[0] || '';
  // Instrukcja planu każe napisać „źródła nie potwierdzają przyczyny”, gdy materiał
  // jej nie podaje. Taka uczciwa odpowiedź spełnia wymaganie „dlaczego”.
  const causeUnconfirmed = /\b(?:zrodla|zrodlo|materialy|dane)\b.{0,60}\bnie\s+(?:potwierdza\w*|wskazuja|podaja|precyzuja|wyjasniaja)\b|\bbrak\s+potwierdzon\w*\s+(?:przyczyn|powod)\w*|\bnie\s+wynika\b.{0,40}\b(?:przyczyn|powod|dlaczego)\w*/.test(text);
  const procedural = /\b(nalezy|trzeba|mozna|sposob|krok|najpierw|potem|nastepnie|first|then|step|wystarczy|uzyj|uzywaj|wykorzystaj|skorzystaj|wybierz|zdobadz|znajdz|idz|wejdz|pokonaj|unikaj|zabij|atakuj|zbuduj|stworz|wez|kup|otworz|podejdz|poczekaj)\b/.exec(text)?.[0] || '';
  const mechanism = /\b(dziala|funkcjonuje|polega|mechanizm|umozliw\w*|pozwala)\b/.exec(text)?.[0] || '';
  const relationshipMarker = /\b(?:relacj\p{L}*|zwiazk\p{L}*|przyjac\p{L}*|wrog\p{L}*|sojusz\p{L}*|zdrad\p{L}*|partner\p{L}*)\b/u.exec(text)?.[0] || '';

  const whenUnconfirmed = /\b(?:zrodla?\w*|materialy|dane|sources?|evidence)\b.{0,120}\bnie\s+(?:podaj\w*|precyzuj\w*|okresl\w*|wskazuj\w*|potwierdz\w*|zawier\w*)\b.{0,80}\b(?:dat\w*|moment\w*|czas\w*|rok\w*)\b/.test(text);

  return {
    why: (Boolean(causalMarker) && hasMeaningfulTail(text, causalMarker)) || causeUnconfirmed,
    how: Boolean(mechanism || procedural) && hasMeaningfulTail(text, mechanism || procedural),
    // A bounded statement that the retrieved sources omit a date is a valid
    // epistemic answer to a temporal query; it must not be mistaken for silence.
    when: /\b(?:1\d{3}|20\d{2})\b|\b(?:po|przed|podczas|w trakcie|pod koniec|na poczatku)\s+\w+|\b(?:w|od|do)\s+(?:styczniu|lutym|marcu|kwietniu|maju|czerwcu|lipcu|sierpniu|wrzesniu|pazdzierniku|listopadzie|grudniu)\b|\b(?:wtedy|nastepnie|pozniej|wcześniej|wczesniej)\b/.test(text) || whenUnconfirmed,
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

const CONTEXT_QUESTION_STOPWORDS = new Set([
  'dlaczego', 'czemu', 'co', 'ile', 'jak', 'jaka', 'jaki', 'jakie', 'kim', 'kto', 'kiedy', 'gdzie', 'czy', 'czym',
  'why', 'what', 'when', 'where', 'who', 'whom', 'which', 'how', 'the', 'this', 'that', 'these', 'those', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'is', 'are', 'was', 'were', 'do', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'of', 'and', 'or',
]);

function extractQuestionContextTerms(question) {
  const matches = String(question || '').match(/(?<![\p{L}\p{N}_])[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\p{N}'’.-]*(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\p{N}'’.-]*)*/gu) || [];
  return matches.map(normalize).filter(term => term.length >= 3 && !CONTEXT_QUESTION_STOPWORDS.has(term));
}

function contextTermMatches(answerText, term) {
  if (!term || term.length < 3) return false;
  if (answerText.includes(term)) return true;
  const answerWords = answerText.split(/\s+/).filter(Boolean);
  const candidateWords = term.split(/\s+/).filter(word => word.length >= 5 && !CONTEXT_QUESTION_STOPWORDS.has(word));
  return candidateWords.some(candidate => answerWords.some(word => word.length >= 5 && (word.startsWith(candidate.slice(0, 5)) || candidate.startsWith(word.slice(0, 5)))));
}

function containsRequiredEntityContext(answer, plan) {
  const answerText = normalize(answer);
  const candidates = [plan?.entity, plan?.game, ...extractQuestionContextTerms(plan?.question)]
    .map(normalize)
    .filter(term => term.length >= 3 && !CONTEXT_QUESTION_STOPWORDS.has(term));
  if (!candidates.length) return Boolean(String(answer || '').trim());
  return candidates.some(term => contextTermMatches(answerText, term));
}

const CLAUSE_STOPWORDS = new Set([
  ...CONTEXT_QUESTION_STOPWORDS,
  'i', 'oraz', 'a', 'ale', 'do', 'nad', 'jego', 'jej', 'ich', 'w', 'z', 'na', 'po', 'przez', 'czy', 'sie',
  'jest', 'sa', 'byl', 'byla', 'byli', 'bylo', 'to', 'ktory', 'ktora', 'ktore', 'dlaczego', 'czemu', 'jaki', 'jaka', 'jakie',
]);

function coversQuestionClauses(answer, clauses) {
  if (!Array.isArray(clauses) || clauses.length < 2) return true;
  const answerWords = normalize(answer).split(/\s+/).filter(Boolean);
  const tokenLists = clauses.map(clause => [...new Set(normalize(clause).split(/\s+/)
    .filter(word => word.length >= 4 && !CLAUSE_STOPWORDS.has(word)))]);
  return tokenLists.every((tokens, index) => {
    const distinctive = tokens.filter(token => !tokenLists.some((other, otherIndex) =>
      otherIndex !== index && other.some(otherToken => otherToken === token)));
    const candidates = distinctive.length ? distinctive : tokens;
    if (!candidates.length) return true;
    return candidates.some(token => answerWords.some(word => {
      if (word === token) return true;
      const prefixLength = Math.min(5, word.length, token.length);
      return prefixLength >= 4 && word.slice(0, prefixLength) === token.slice(0, prefixLength);
    }));
  });
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
      : id === 'clause_coverage'
        ? coversQuestionClauses(answer, plan.clauses)
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
