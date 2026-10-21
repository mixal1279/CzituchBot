'use strict';
// Regresje dla poprawek z benchmarku live AI (commit 436f41d0).
// Każdy test opisuje zachowanie, które przed poprawką odrzucało poprawną odpowiedź
// albo — w przypadku testów negatywnych — chroni walidację przed rozluźnieniem.
const test = require('node:test');
const assert = require('node:assert');

const {
  spojnoscTlumaczeniaClaimu,
  sprawdzPokrycieClaimamiOdpowiedzi,
  wyodrebnijNazwyWlasne,
} = require('../ai/claimValidation');
const { decideValidation, finalText, STATUS } = require('../ai/pipeline');

// --- 1. Odpowiedź częściowa musi zostać wydana -------------------------------------

test('odpowiedź częściowa jest dostarczana, a odrzucona nadal jest odrzucana', () => {
  assert.deepEqual(decideValidation(STATUS.SOFT_ACCEPTED), {
    finalStatus: STATUS.SOFT_ACCEPTED,
    retry: false,
    reason: 'partial_answer_delivered',
  });
  const partial = 'Malenia jest opcjonalnym bossem w Elden Ring. Nie wszystkie szczegóły da się potwierdzić w dostępnych źródłach.';
  assert.equal(finalText(partial, STATUS.SOFT_ACCEPTED, { partialAnswer: partial }), partial);
  assert.equal(finalText('fakt spoza źródła', STATUS.REJECTED), 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.');
});

test('pełna odpowiedź nie jest wydawana, gdy zabrakło zweryfikowanego partialAnswer', () => {
  // Gwarancja strukturalna: przy statusie soft_accepted publikujemy wyłącznie
  // partialAnswer z walidatora. Sam tekst przekazany do finalText nie jest
  // źródłem prawdy — bez partialAnswer wychodzi odmowa, nigdy pełna odpowiedź.
  const pelnaOdpowiedz = 'Malenia jest opcjonalnym bossem w Elden Ring. W dodatku zabija smoka.';
  assert.equal(
    finalText(pelnaOdpowiedz, STATUS.SOFT_ACCEPTED),
    'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.',
  );
  const partial = 'Malenia jest opcjonalnym bossem w Elden Ring.';
  assert.equal(
    finalText(pelnaOdpowiedz, STATUS.SOFT_ACCEPTED, { partialAnswer: partial }),
    partial,
  );
});

// --- 2. Nazwa przetłumaczona nie jest utratą encji ----------------------------------

test('nazwa przetłumaczona przez alias przechodzi kontrolę spójności tłumaczenia', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Najłatwiej dotrzeć do wózka zaczynając od Katedry Smoczej Komunii i podążając wschodnim szlakiem.',
    'The easiest way to get there is starting at the Cathedral of Dragon Communion and just following the road east.',
    { evidenceQuote: 'The easiest way to get there is starting at the Cathedral of Dragon Communion and just following the road east.' },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

// --- 3. Podmiana i utrata encji nadal są wykrywane (strażniki podmiany) --------------

test('podmiana encji w tłumaczeniu nadal jest odrzucana', () => {
  const swapped = spojnoscTlumaczeniaClaimu('Malenia jest bossem.', 'Radahn is a boss.');
  assert.equal(swapped.ok, false, JSON.stringify(swapped));
  assert.match(swapped.reason, /nazwy własne/);
});

test('utrata encji w tłumaczeniu nadal jest odrzucana', () => {
  const dropped = spojnoscTlumaczeniaClaimu('Geralt spotkał Gandalfa.', 'Geralt met a stranger.');
  assert.equal(dropped.ok, false, JSON.stringify(dropped));
  assert.match(dropped.reason, /nazwy własne/);
});

// --- 4. Zwykły rzeczownik pospolity nie jest nazwą własną ----------------------------

test('rzeczownik pospolity w liczbie mnogiej nie jest traktowany jako encja', () => {
  const names = wyodrebnijNazwyWlasne('Postacie Origin są bohaterami z własną historią.');
  assert.ok(!names.includes('postacie'), JSON.stringify(names));
  assert.ok(names.includes('origin'), JSON.stringify(names));
});

test('przysłówek na początku zdania nie jest traktowany jako encja', () => {
  const names = wyodrebnijNazwyWlasne('Najłatwiej dotrzeć do wózka zaczynając od Katedry Smoczej Komunii.');
  assert.ok(!names.includes('najlatwiej'), JSON.stringify(names));
});

// --- 5. Pokrycie zdań: metadane źródłowe i anafora -----------------------------------

test('wskazanie źródła w nawiasie nie jest twierdzeniem i nie blokuje pokrycia', () => {
  const answer = 'Wielki Miecz znajduje się w opuszczonym wózku w północno-zachodniej części Caelid. '
    + 'Aby go zdobyć, należy pokonać strażników, używając ataków dystansowych. '
    + '(Źródło: opis lokalizacji Greatsword w źródłach 4 i 6.)';
  const coverage = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Wielki Miecz znajduje się w opuszczonym wózku w północno-zachodniej części Caelid.' },
    { claim: 'Aby zdobyć miecz, należy pokonać strażników, używając ataków dystansowych.' },
  ]);
  assert.equal(coverage.ok, true, JSON.stringify(coverage));
  assert.equal(coverage.checkedSentences, 2, JSON.stringify(coverage));
});

test('wskazanie źródła w środku zdania nie ukrywa reszty zdania przed kontrolą pokrycia', () => {
  // Usuwamy tylko nawias ze źródłem — twierdzenie po nim nadal musi mieć pokrycie.
  const answer = 'Astarion jest wysokim elfem-lotrzykiem (Źródło: opis postaci), wampirzym potomkiem.';
  const coverage = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Astarion jest wysokim elfem-lotrzykiem.' },
  ]);
  assert.equal(coverage.ok, false, JSON.stringify(coverage));
});

test('zdanie z zaimieniem pokrywa claim o tej samej encji', () => {
  const answer = 'Astarion jest wysokim elfem-lotrzykiem, wampirzym potomkiem. '
    + 'Jego historia obejmuje ponad dwieście lat służby pod okrutnym panem.';
  const coverage = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Astarion jest wysokim elfem-lotrzykiem.' },
    { claim: 'Astarion jest potomkiem wampira.' },
    { claim: 'Astarion był poddanym wampirze przez ponad dwieście lat.' },
  ]);
  assert.equal(coverage.ok, true, JSON.stringify(coverage));
});

test('zdanie z zaimieniem bez pokrywającego claimu pozostaje niepokryte', () => {
  const answer = 'Astarion jest wysokim elfem-lotrzykiem. Jego historia obejmuje ponad dwieście lat służby.';
  const coverage = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Astarion jest wysokim elfem-lotrzykiem.' },
  ]);
  assert.equal(coverage.ok, false, JSON.stringify(coverage));
});

test('niepokryty materiał pojęciowy obniża pokrycie zdania', () => {
  // Zdanie wspomina o wampirze, ale żaden claim tego nie potwierdza — bramka
  // pojęć musi to wykryć, inaczej odpowiedź przeszłaby z niepotwierdzonym faktem.
  const answer = 'Astarion jest wysokim elfem-lotrzykiem, wampirzym potomkiem.';
  const coverage = sprawdzPokrycieClaimamiOdpowiedzi(answer, [
    { claim: 'Astarion jest wysokim elfem-lotrzykiem.' },
  ]);
  assert.equal(coverage.ok, false, JSON.stringify(coverage));
});
