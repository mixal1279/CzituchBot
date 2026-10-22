'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.CZITUCHBOT_SKIP_STARTUP_IO = '1';

const { usunEtykietyEvidenceCandidate, maEtykieteEvidenceCandidate, oczyscOdpowiedzPrzedWalidacja } = require('../ai/answer-sanitize');
const { ocenJakoscOdpowiedzi } = require('../ai/quality');
const { __validatorTestHooks: hooks } = require('../czituch_bot');

const ZDANIE = 'Wheatley przejął kontrolę nad GLaDOS, ponieważ Chell i on zmusili wymianę rdzeni, aby Wheatley mógł przejąć sterowanie obiektem i umożliwić im ucieczkę.';
const DANE = [
  '[SOURCE 1]',
  'TYTUŁ: Portal 2',
  'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
  'Chell and Wheatley force a core transfer on GLaDOS so that Wheatley can take control of the facility and he and Chell can escape. Wheatley przejął kontrolę nad GLaDOS. Gra została wydana w 2011 roku.',
  '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
].join('\n');
const PYTANIE = 'W grze Portal 2: Dlaczego Wheatley przejął kontrolę nad GLaDOS?';

function zaakceptowanyWerdykt() {
  return { status: 'accepted', ok: true, valid: true, supported: true, complete: true, hallucination: false, confidence: 1, unsupported_claims: [] };
}

function guard(odpowiedz, { pytanie = PYTANIE, dane = DANE, profil = 'lore' } = {}) {
  return hooks.zastosujDeterministyczneGuards(
    zaakceptowanyWerdykt(), odpowiedz, dane, pytanie, { maxZdania: 3, maxZnakow: 900 }, {}, profil,
  );
}

// ── sanitizer ────────────────────────────────────────────────────────────────

test('sanitizer usuwa etykiety w znanych wariantach i nie zostawia śmieci', () => {
  const przypadki = [
    ['Zdanie. (EVIDENCE CANDIDATE 1)', 'Zdanie.'],
    ['Zdanie (EVIDENCE CANDIDATE 1).', 'Zdanie.'],
    ['Zdanie. (EVIDENCE CANDIDATES 1, 2)', 'Zdanie.'],
    ['Zdanie. (EVIDENCE CANDIDATES 1 i 2)', 'Zdanie.'],
    ['Zdanie. [EVIDENCE CANDIDATE 1]', 'Zdanie.'],
    ['Zdanie. (EVIDENCE CANDIDATE #1)', 'Zdanie.'],
    ['Zdanie. (EVIDENCE CANDIDATE: 1)', 'Zdanie.'],
    ['Zdanie. (candidate 2)', 'Zdanie.'],
    ['Zdanie. EVIDENCE CANDIDATE 3', 'Zdanie.'],
    ['Pierwsze. (EVIDENCE CANDIDATE 1) Drugie. (EVIDENCE CANDIDATE 2)', 'Pierwsze. Drugie.'],
    ['Zdanie (EVIDENCE CANDIDATE 1), a potem drugie.', 'Zdanie, a potem drugie.'],
  ];
  for (const [wejscie, oczekiwane] of przypadki) {
    assert.equal(usunEtykietyEvidenceCandidate(wejscie), oczekiwane, `wejście: ${wejscie}`);
    assert.equal(maEtykieteEvidenceCandidate(wejscie), true, `detekcja: ${wejscie}`);
  }
});

test('sanitizer nie rusza zwykłego tekstu ani liczb w nawiasach', () => {
  const nietkniete = [
    ZDANIE,
    'Gra została wydana w 2011 roku (patrz: wydanie z 2012).',
    'Kandydat nr 2 wygrał wybory. The candidate 2 won.',
    'Linia pierwsza.\nLinia druga.',
  ];
  for (const tekst of nietkniete) {
    assert.equal(usunEtykietyEvidenceCandidate(tekst), tekst);
    assert.equal(maEtykieteEvidenceCandidate(tekst), false);
  }
});

test('sanitizer jest idempotentny i odporny na nie-stringi', () => {
  const raz = usunEtykietyEvidenceCandidate(`${ZDANIE} (EVIDENCE CANDIDATE 1)`);
  assert.equal(raz, ZDANIE);
  assert.equal(usunEtykietyEvidenceCandidate(raz), raz);
  assert.equal(usunEtykietyEvidenceCandidate(null), '');
  assert.equal(usunEtykietyEvidenceCandidate(undefined), '');
  assert.equal(usunEtykietyEvidenceCandidate(42), '42');
});

// ── dokumentacja pierwotnego błędu ───────────────────────────────────────────

test('regresja why-001: etykieta po kropce wyglądała dla bramki jakości na ucięte zdanie', () => {
  const zEtykieta = `${ZDANIE} (EVIDENCE CANDIDATE 1)`;
  assert.equal(zEtykieta.length - ZDANIE.length, 23, 'luka 23 znaków z logów benchmarku');
  const surowy = ocenJakoscOdpowiedzi(PYTANIE, zEtykieta, {}, 'lore');
  assert.equal(surowy.ok, false);
  assert.ok(surowy.issues.some(i => /nie kończy się pełnym zdaniem/.test(i)));
  assert.equal(ocenJakoscOdpowiedzi(PYTANIE, usunEtykietyEvidenceCandidate(zEtykieta), {}, 'lore').ok, true);
});

// ── guard widzi ten sam tekst co walidator ───────────────────────────────────

test('guard akceptuje odpowiedź zaakceptowaną przez walidator niezależnie od wariantu etykiety', () => {
  const warianty = [
    ZDANIE,
    `${ZDANIE} (EVIDENCE CANDIDATE 1)`,
    `${ZDANIE} (EVIDENCE CANDIDATES 1, 2)`,
    `${ZDANIE} [EVIDENCE CANDIDATE 1]`,
    `${ZDANIE} (EVIDENCE CANDIDATE #1)`,
    `${ZDANIE.slice(0, -1)} (EVIDENCE CANDIDATE 1).`,
  ];
  for (const odpowiedz of warianty) {
    const wynik = guard(odpowiedz);
    assert.equal(wynik.status, 'accepted', `${odpowiedz.slice(-40)} → ${wynik.reason}`);
  }
});

test('etykieta z numerem nie jest traktowana jako „twarda liczba” spoza źródła', () => {
  const wynik = guard(`${ZDANIE} (EVIDENCE CANDIDATE 17)`);
  assert.equal(wynik.status, 'accepted', wynik.reason);
});

test('oczyscOdpowiedzPrzedWalidacja usuwa etykiety, ale dalej wycina linki i linie źródeł', () => {
  const wejscie = `${ZDANIE} (EVIDENCE CANDIDATE 1)\nhttps://example.com/portal2\nŹródło: wiki`;
  assert.equal(oczyscOdpowiedzPrzedWalidacja(wejscie), ZDANIE);
});

// ── kontrole negatywne: poprawka nie może osłabić walidacji ──────────────────

test('ucięta odpowiedź nadal jest odrzucana — także gdy ma etykietę', () => {
  const uciete = [
    'Wheatley przejął kontrolę nad GLaDOS, ponieważ Chell i on zmusili wymianę rdzeni, aby',
    'Wheatley przejął kontrolę nad GLaDOS, ponieważ Chell i on zmusili wymianę rdzeni, aby (EVIDENCE CANDIDATE 1)',
    'Wheatley przejął kontrolę nad GLaDOS, ponieważ Chell i on zmusili wymianę rdzeni, aby [EVIDENCE CANDIDATE 1]',
  ];
  for (const odpowiedz of uciete) {
    const wynik = guard(odpowiedz);
    assert.equal(wynik.status, 'rejected', odpowiedz);
    assert.match(wynik.reason, /nie kończy się pełnym zdaniem/);
  }
});

test('zła liczba nadal jest odrzucana jako twardy fakt — także gdy ma etykietę', () => {
  for (const odpowiedz of [
    'Portal 2 wydano w 2019 roku.',
    'Portal 2 wydano w 2019 roku. (EVIDENCE CANDIDATE 1)',
  ]) {
    const wynik = guard(odpowiedz, { pytanie: 'W grze Portal 2: Kiedy wydano grę?', profil: 'timeline' });
    assert.equal(wynik.status, 'rejected', odpowiedz);
    assert.match(wynik.reason, /twarde dane/);
  }
  const dobra = guard('Portal 2 wydano w 2011 roku. (EVIDENCE CANDIDATE 1)', { pytanie: 'W grze Portal 2: Kiedy wydano grę?', profil: 'timeline' });
  assert.equal(dobra.status, 'accepted', dobra.reason);
});

test('odpowiedź będąca samą etykietą lub zbyt krótka jest odrzucana', () => {
  for (const odpowiedz of ['(EVIDENCE CANDIDATE 1)', 'Tak. (EVIDENCE CANDIDATE 1)']) {
    const wynik = guard(odpowiedz);
    assert.equal(wynik.status, 'rejected', odpowiedz);
  }
});

test('odrzucenie przez walidator nie jest nadpisywane przez sanityzację', () => {
  const odrzucony = { status: 'rejected', ok: false, reason: 'evidence_not_verified' };
  const wynik = hooks.zastosujDeterministyczneGuards(odrzucony, `${ZDANIE} (EVIDENCE CANDIDATE 1)`, DANE, PYTANIE, {}, {}, 'lore');
  assert.equal(wynik, odrzucony);
});
