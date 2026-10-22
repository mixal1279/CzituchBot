'use strict';

// Jedno źródło prawdy dla czyszczenia technicznych etykiet dowodów z odpowiedzi modelu.
//
// Dlaczego osobny moduł: etykiety „(EVIDENCE CANDIDATE 1)” były usuwane tylko
// wewnątrz walidatora (na lokalnej kopii tekstu), a deterministyczne guardy
// (ai/quality.js → „odpowiedź nie kończy się pełnym zdaniem”) dostawały
// oryginał z etykietą po kropce. Walidator mówił „accepted”, guard odrzucał
// to samo zdanie. Teraz każdy etap wywołuje tę samą funkcję.

const NUM = String.raw`#?\d+`;
const SEP = String.raw`\s*(?:[,;/&]|\bi\b|\boraz\b|\band\b)\s*`;
const NUMS = `${NUM}(?:${SEP}${NUM})*`;

// W nawiasie okrągłym/kwadratowym: „(EVIDENCE CANDIDATE 1)”, „[EVIDENCE CANDIDATES 1, 2]”,
// „(EVIDENCE CANDIDATE #1)”, „(EVIDENCE CANDIDATE: 1)”, „(candidate 2)”.
const BRACKETED = String.raw`[(\[]\s*(?:EVIDENCE\s+)?CANDIDATES?\s*[:#]?\s*${NUMS}\s*[)\]]`;
// Bez nawiasu wymagamy pełnego „EVIDENCE CANDIDATE”, żeby nie ruszać zwykłego
// słowa „candidate” w treści odpowiedzi.
const BARE = String.raw`EVIDENCE\s+CANDIDATES?\s*[:#]?\s*${NUMS}`;

const LABEL_SOURCE = String.raw`\s*(?:${BRACKETED}|${BARE})`;
const LABEL_GLOBAL = new RegExp(LABEL_SOURCE, 'gi');
const LABEL_TEST = new RegExp(LABEL_SOURCE, 'i');

function usunEtykietyEvidenceCandidate(tekst) {
  return String(tekst || '')
    .replace(LABEL_GLOBAL, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function maEtykieteEvidenceCandidate(tekst) {
  return LABEL_TEST.test(String(tekst || ''));
}

// Czyszczenie tekstu tuż przed walidacją: etykiety dowodów, linki i linie ze źródłami
// nie są częścią odpowiedzi ocenianej przez walidator ani guardy.
function oczyscOdpowiedzPrzedWalidacja(tekst) {
  return usunEtykietyEvidenceCandidate(tekst)
    .split(/\r?\n/)
    .filter(line => !/https?:\/\/|www\./i.test(line))
    .filter(line => !/^(?:📚\s*)?Źródło(?: poradnika)?\s*:/i.test(line))
    .join('\n')
    .replace(/\[[^\]]*\]\(https?:\/\/[^)]+\)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { usunEtykietyEvidenceCandidate, maEtykieteEvidenceCandidate, oczyscOdpowiedzPrzedWalidacja };
