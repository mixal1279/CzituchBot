'use strict';

// Polskie liczby słowne były niewidoczne dla obu warstw kontrolnych:
// „wyodrebnijLiczbyIDaty” (claim ↔ dowód) i „wyodrebnijTwardeTokeny”
// (odpowiedź ↔ źródła) rozpoznawały wyłącznie zapis cyfrowy. Zmyślona liczba
// zapisana słownie („trzysta lat”, „dwadzieścia”) przechodziła obie bramki,
// choć cyfrowy zapis tej samej liczby był łapany.
//
// Nie parsujemy wartości (trzysta dwadzieścia trzy = 323) — wystarczy, że
// kontrolne widzą DOKŁADNIE to samo słowo w claimie i w dowodzie. Brak słowa
// w dowodzie oznacza wtedy brak potwierdzenia, tak jak przy zapisie cyfrowym.
const PL_NUMBER_WORDS = new Set([
  'jeden', 'jedna', 'jedno', 'jednego', 'jednej', 'jednym',
  'dwa', 'dwie', 'dwóch', 'dwóch', 'dwoma',
  'trzy', 'trzech', 'trzema',
  'cztery', 'czterech', 'czterema',
  'pięć', 'pięciu', 'pięcioma',
  'sześć', 'sześciu', 'sześcioma',
  'siedem', 'siedmiu', 'siedmioma',
  'osiem', 'ośmiu', 'osiemoma',
  'dziewięć', 'dziewięciu', 'dziewięcioma',
  'dziesięć', 'dziesięciu', 'dziesięcioma',
  'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście',
  'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście',
  'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt',
  'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt',
  'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset',
  'siedemset', 'osiemset', 'dziewięćset',
  'tysiąc', 'tysiące', 'tysięcy', 'tysiac', 'tysiace', 'tysiecy',
  'milion', 'miliony', 'milionów', 'miliard', 'miliardy', 'miliardów',
]);

// Formy porównujemy po normalizacji (małe litery, bez diakrytyków) — inaczej
// słowo z tekstu nigdy nie trafiłoby do słownika zapisanego z diakrytykami.
function normalizujSlowoLiczbowe(word) {
  return String(word || '').toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
}

// Zwraca slowa liczbowe obecne w tekście (po normalizacji do małych liter
// i bez polskich znaków diakrytycznych, tak jak reszta kodu).
function slowaLiczbowe(text) {
  const raw = String(text || '').toLocaleLowerCase('pl-PL');
  const words = raw.match(/[\p{L}]+/gu) || [];
  const found = new Set();
  for (const word of words) {
    const normalized = normalizujSlowoLiczbowe(word);
    if (PL_NUMBER_WORDS_NORMALIZED.has(normalized)) found.add(normalized);
  }
  return [...found];
}

const PL_NUMBER_WORDS_NORMALIZED = new Set([...PL_NUMBER_WORDS].map(normalizujSlowoLiczbowe));

module.exports = { PL_NUMBER_WORDS, PL_NUMBER_WORDS_NORMALIZED, slowaLiczbowe, normalizujSlowoLiczbowe };
