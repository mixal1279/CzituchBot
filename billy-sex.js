'use strict';

const KOMENTARZE_DOPASOWANIA = [
  { max: 20, tekst: 'Zakalcowa relacja — ciasto chyba nie wyrosło.' },
  { max: 40, tekst: 'Trochę czerstwa znajomość. Przyda się świeży wypiek.' },
  { max: 60, tekst: 'Bułeczka powoli się dopieka. Jest potencjał!' },
  { max: 80, tekst: 'Gorąca kajzerka prosto z pieca! Robi się ciekawie.' },
  { max: 99, tekst: 'Piekielna chemia! Piekarnik ledwo wytrzymuje!' },
  { max: 100, tekst: 'MIŁOŚĆ WYPIEKANA PRZEZ SAMEGO PIEKARZA! 🔥' },
];

function buildSexResponse({ message, nick, rng = Math.random }) {
  const parts = String(message || '').trim().split(/\s+/);
  if (!/^!sex$/i.test(parts[0] || '')) return null;
  if (parts.length !== 2 || !parts[1] || !/^@?[\p{L}\p{N}_-]+$/u.test(parts[1])) {
    return 'Użycie: !sex @nick';
  }

  const target = parts[1].replace(/^@/, '');
  const roll = Math.max(0, Math.min(1 - Number.EPSILON, Number(rng()) || 0));
  const percentage = Math.floor(roll * 101);
  const comment = KOMENTARZE_DOPASOWANIA.find(({ max }) => percentage <= max).tekst;

  return `@${nick} i @${target} – Wasza piekielna miłość ma dziś temperaturę ${percentage}%! ${comment} 🥖🔥`;
}

module.exports = { KOMENTARZE_DOPASOWANIA, buildSexResponse };
