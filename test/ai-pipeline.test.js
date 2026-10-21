'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEvidenceText, evaluateEvidence, sanitizeQuestion, decideValidation, finalText, STATUS } = require('../ai/pipeline');
const { buildAnswerPlan, assessAnswerCompleteness } = require('../ai/answer-plan');
const { sprawdzPokrycieClaimamiOdpowiedzi } = require('../ai/claimValidation');

test('pipeline parser reads SOURCE blocks with metadata', () => {
  const parsed = parseEvidenceText([
    '[SOURCE 1]',
    'TYTUŁ: Portal 2 Wiki',
    'URL: https://example.com/portal-2',
    'Wheatley przejmuje kontrolę nad systemem.',
    '',
    '[SOURCE 2]',
    'TYTUŁ: GameFAQs Guide',
    'URL: https://gamefaqs.gamespot.com/portal-2',
    'Opis rozwiązania.',
  ].join('\n'));

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sourceId, 'SOURCE 1');
  assert.equal(parsed[0].title, 'Portal 2 Wiki');
  assert.equal(parsed[0].url, 'https://example.com/portal-2');
  assert.match(parsed[0].content, /Wheatley przejmuje kontrolę/);
  assert.equal(parsed[1].title, 'GameFAQs Guide');
});

test('pipeline parser extracts only marked source content and trims legacy blocks', () => {
  const marked = parseEvidenceText([
    '[SOURCE 1]',
    'TYP: article',
    'TYTUŁ: Testowy tytuł',
    'HOST: example.com',
    'URL: https://example.com/test',
    'HEURYSTYCZNA_OCENA: 0.91',
    'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
    'właściwy tekst',
    '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
  ].join('\n'));
  assert.equal(marked[0].content, 'właściwy tekst');

  const legacy = parseEvidenceText('[SOURCE 1]\n  Zwykła treść bez znaczników.  ');
  assert.equal(legacy[0].content, 'Zwykła treść bez znaczników.');
});

test('pipeline parser accepts REFERENCE headers case-insensitively', () => {
  const parsed = parseEvidenceText('[reference Portal 2]\nTYTUŁ: Reference\nURL: https://example.com/reference\nTreść.');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sourceId, 'reference Portal 2');
  assert.equal(parsed[0].title, 'Reference');
  assert.equal(parsed[0].url, 'https://example.com/reference');
});

test('pipeline parser ignores preamble and handles missing metadata', () => {
  const parsed = parseEvidenceText([
    'Preamble.',
    '[SOURCE 1]',
    'Tylko treść bez tytułu i URL.',
    '[SOURCE 2]',
    'TYTUŁ: Drugi',
  ].join('\n'));

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, 'SOURCE 1');
  assert.equal(parsed[0].url, '');
  assert.match(parsed[0].content, /Tylko treść/);
  assert.doesNotMatch(parsed[0].content, /Preamble/);
  assert.equal(parsed[1].title, 'Drugi');
});

test('pipeline parser returns no sources for plain text', () => {
  assert.deepEqual(parseEvidenceText('zwykła odpowiedź bez źródeł'), []);
  assert.deepEqual(parseEvidenceText(''), []);
  assert.deepEqual(parseEvidenceText(null), []);
});

test('pipeline evaluateEvidence scores parsed sources and requires validation for lore', () => {
  const result = evaluateEvidence(
    'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?',
    { is_lore: true, game: 'Portal 2', needs_web: true },
    [
      '[SOURCE 1]',
      'TYTUŁ: Portal 2 Wiki',
      'URL: https://minecraft.wiki/portal-2',
      'Wheatley przejmuje kontrolę nad GLaDOS.',
      '[SOURCE 2]',
      'TYTUŁ: GameFAQs',
      'URL: https://gamefaqs.gamespot.com/portal-2',
      'Wheatley kontroluje GLaDOS.',
    ].join('\n'),
  );

  assert.equal(result.evidence.sourceCount, 2);
  assert.ok(result.evidence.independentHosts >= 2);
  assert.ok(['usable', 'strong'].includes(result.evidence.status));
  assert.equal(result.policy.requireValidator, true);
});

test('pipeline input and validation decisions are deterministic', () => {
  assert.equal(sanitizeQuestion('   ', null).ok, false);
  assert.deepEqual(sanitizeQuestion('1234567890', null, 5), { ok: false, reason: 'too_long', maxLength: 5 });
  assert.deepEqual(decideValidation(STATUS.ACCEPTED), { finalStatus: STATUS.ACCEPTED, retry: false });
  assert.equal(decideValidation(STATUS.REJECTED, { allowRetry: true }).retry, true);
  assert.deepEqual(decideValidation(STATUS.UNVERIFIED), {
    finalStatus: STATUS.UNVERIFIED,
    retry: false,
    reason: 'validator_unavailable_but_deterministic_gates_passed',
  });
  assert.equal(decideValidation('unexpected').finalStatus, STATUS.UNAVAILABLE);
});

test('answer plans preserve source-backed role/location details and prohibit guessed dates', () => {
  const who = buildAnswerPlan('Kim jest Astarion?', { intent: 'web_fact', is_lore: true });
  assert.match(who.instruction, /istotną rolę lub relację/);
  assert.match(who.instruction, /towarzysz/);

  const where = buildAnswerPlan('Gdzie znaleźć Wielki Miecz?', { intent: 'web_fact', game: 'Elden Ring', is_gameplay: true });
  assert.match(where.instruction, /nazwane miejsce lub region/);
  assert.match(where.instruction, /punkt orientacyjny/);

  const when = buildAnswerPlan('Kiedy Geralt przybywa do Novigradu?', { intent: 'web_fact', game: 'The Witcher 3' });
  assert.match(when.instruction, /nie zgaduj daty/);
});

test('location-only gameplay detection recognizes inflected boss, quest, mission, and guide terms', () => {
  for (const question of ['Gdzie znaleźć bossa w Elden Ring?', 'Gdzie znaleźć questy w Wiedźminie 3?', 'Gdzie znaleźć misje poboczne?', 'Gdzie znaleźć poradnika do gry?', 'Gdzie znaleźć solucję do questa?']) {
    const plan = buildAnswerPlan(question, { intent: 'gameplay', is_gameplay: true, game: 'Elden Ring' });
    assert.ok(plan.requirements.some(item => item.id === 'steps'), `${question} should retain the steps requirement`);
  }
});

test('a source-scoped missing-date caveat is a valid temporal fallback without bypassing factual claim coverage', () => {
  const answer = 'Źródła potwierdzają, że Geralt przybywa do Novigradu, ale nie podają konkretnej daty ani momentu w czasie gry.';
  const plan = buildAnswerPlan('Kiedy Geralt przybywa do Novigradu?', { intent: 'web_fact', game: 'The Witcher 3' });
  assert.equal(assessAnswerCompleteness(answer, plan).missing.includes('when'), false);
  const coverage = sprawdzPokrycieClaimamiOdpowiedzi(answer, [{ claim: 'Geralt przybywa do Novigradu' }]);
  assert.equal(coverage.ok, true, JSON.stringify(coverage));
});

test('pipeline finalText replaces terminal failure output and sanitizes accepted output', () => {
  assert.equal(finalText('anything', STATUS.REJECTED), 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.');
  assert.equal(
    finalText('odpowiedź robocza', STATUS.UNVERIFIED),
    '⚠️ Odpowiedź niezweryfikowana — walidator jest niedostępny. odpowiedź robocza',
  );
  assert.equal(finalText('', STATUS.UNVERIFIED), 'Chwilowo nie mogę potwierdzić tej informacji, więc nie będę zgadywać.');
  assert.equal(finalText('  poprawna odpowiedź  ', STATUS.ACCEPTED, {
    sanitizeResponse: value => value.replace(/\s+/g, ' '),
  }), 'poprawna odpowiedź');
});


test('pipeline delivers a soft-accepted answer, but never an ordinary rejected one', () => {
  // Odpowiedź częściowa to nie jest odpowiedź odrzucona: walidator buduje ją
  // wyłącznie z claimów, których cytat przeszedł lokalną kontrolę dowodową
  // (partialAnswer), i dołącza zastrzeżenie o niepotwierdzonych szczegółach.
  // Zamiana jej na odmowę niszczyła poprawne odpowiedzi.
  assert.deepEqual(decideValidation(STATUS.SOFT_ACCEPTED), {
    finalStatus: STATUS.SOFT_ACCEPTED,
    retry: false,
    reason: 'partial_answer_delivered',
  });
  const partial = 'Malenia jest opcjonalnym bossem w Elden Ring. Nie wszystkie szczegóły da się potwierdzić w dostępnych źródłach.';
  assert.equal(finalText(partial, STATUS.SOFT_ACCEPTED), partial);
  // Pusta odpowiedź częściowa nie może wyprodukować pustej wiadomości.
  assert.equal(finalText('', STATUS.SOFT_ACCEPTED), 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.');
  // Odpowiedź zwykła odrzucona nadal jest zamieniana na odmowę — to jest granica,
  // której nie wolno przekroczyć: odrzucona treść może zawierać fakty spoza źródła.
  assert.equal(finalText('odpowiedź z niepotwierdzonym faktem', STATUS.REJECTED), 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.');
});
