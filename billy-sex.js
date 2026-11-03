'use strict';

const SCENARIUSZE_DLA_DWOJGA = [
  'poszli na zaplecze tworzyć nowy smak bułki! Po godzinach ugniatania ciasta wyszła im idealna, chrupiąca **Maślana Rozkosz**. Czat oszalał, kolejki stoją pod piekarnią! 🥐✨',
  'próbowali stworzyć nowy smak bułki, ale poniosła ich fantazja... Dodali za dużo drożdży, wszystko wybuchło, a oni oboje są teraz cali w mące. Bułki z tego nie będzie! 💥🍞',
  'zamknęli się w kuchni i stworzyli bułkę o smaku „Piekielnego Chili”. Atmosfera była tak gorąca, że straż pożarna musiała studzić piec! 🌶️🥖',
  'poszli ugniatać ciasto na nowy sekretny smak. Wyszła im bułka o smaku... kebaba z dżemem truskawkowym. Sanepid już jedzie na miejsce. 🤢🥖',
];

const SCENARIUSZE_SOLO = [
  'w laboratorium piekarza powstała idealna, chrupiąca **Maślana Rozkosz**. Klienci ustawiają się w kolejce, a piekarz już szykuje złoty medal! 🥐✨',
  'eksperyment z drożdżami wymknął się spod kontroli. Ciasto wystrzeliło z dzieży, a całe laboratorium pokryła warstwa mąki. Bułek dziś nie będzie! 💥🍞',
  'udało się stworzyć bułkę o smaku „Piekielnego Chili”. Była tak ostra, że trzeba było wezwać straż pożarną do studzenia pieca! 🌶️🥖',
  'powstała bułka o smaku kebaba z dżemem truskawkowym. Sanepid został już powiadomiony. 🤢🥖',
];

function losuj(scenariusze, rng) {
  const roll = Math.max(0, Math.min(1 - Number.EPSILON, Number(rng()) || 0));
  return scenariusze[Math.floor(roll * scenariusze.length)];
}

function buildSexResponse({ message, nick, rng = Math.random }) {
  const parts = String(message || '').trim().split(/\\s+/);
  if (!/^!sex$/i.test(parts[0] || '')) return null;
  if (parts.length > 2 || (parts.length === 2 && !/^@?[\\p{L}\\p{N}_-]+$/u.test(parts[1]))) {
    return 'Użycie: !sex lub !sex @nick';
  }
  if (parts.length === 1) return `@${nick} – ${losuj(SCENARIUSZE_SOLO, rng)}`;
  const target = parts[1].replace(/^@/, '');
  return `@${nick} i @${target} ${losuj(SCENARIUSZE_DLA_DWOJGA, rng)}`;
}

module.exports = { SCENARIUSZE_DLA_DWOJGA, SCENARIUSZE_SOLO, buildSexResponse };