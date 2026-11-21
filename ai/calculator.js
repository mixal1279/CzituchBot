'use strict';

const MAX_EXPRESSION_LENGTH = 120;
const MAX_TOKENS = 64;
const MAX_DEPTH = 12;
const MAX_ABS_VALUE = 1e12;

function wyodrebnijWyrazenie(pytanie) {
  if (typeof pytanie !== 'string' || pytanie.length > 500) return null;
  let wyrazenie = pytanie.trim();
  wyrazenie = wyrazenie.replace(/^(?:oblicz|policz|ile\s+to|ile\s+wynosi|wynik\s+dzia[lł]ania)\s*[:=]?\s*/iu, '');
  wyrazenie = wyrazenie.replace(/[?!.]+$/u, '').trim();
  if (!wyrazenie || wyrazenie.length > MAX_EXPRESSION_LENGTH) return null;
  return wyrazenie;
}

function tokenizuj(wyrazenie) {
  const tekst = wyrazenie.replace(/[×]/gu, '*').replace(/[÷]/gu, '/');
  const tokeny = [];
  let indeks = 0;
  while (indeks < tekst.length) {
    const znak = tekst[indeks];
    if (/\s/u.test(znak)) { indeks++; continue; }
    const fragment = tekst.slice(indeks);
    const liczba = fragment.match(/^(?:\d+(?:[.,]\d*)?|[.,]\d+)/u);
    if (liczba) {
      const token = liczba[0].replace(',', '.');
      const wartosc = Number(token);
      if (!Number.isFinite(wartosc) || Math.abs(wartosc) > MAX_ABS_VALUE) throw new Error('number_out_of_range');
      tokeny.push({ typ: 'number', wartosc });
      indeks += liczba[0].length;
    } else if ('+-*/()'.includes(znak)) {
      tokeny.push({ typ: znak, wartosc: znak });
      indeks++;
    } else {
      throw new Error('invalid_character');
    }
    if (tokeny.length > MAX_TOKENS) throw new Error('too_many_tokens');
  }
  if (!tokeny.some(token => ['+', '-', '*', '/'].includes(token.typ))) throw new Error('operator_required');
  return tokeny;
}

function obliczWyrazenie(wyrazenie) {
  if (typeof wyrazenie !== 'string' || !wyrazenie.trim()) return { ok: false, reason: 'empty_expression' };
  if (wyrazenie.length > MAX_EXPRESSION_LENGTH) return { ok: false, reason: 'expression_too_long' };
  let tokeny;
  try { tokeny = tokenizuj(wyrazenie); }
  catch (error) { return { ok: false, reason: error.message }; }

  let indeks = 0;
  let glebokosc = 0;
  const biezacy = () => tokeny[indeks] || null;
  const pobierz = typ => {
    if (biezacy()?.typ !== typ) throw new Error('unexpected_token');
    return tokeny[indeks++];
  };
  const sprawdzWynik = wartosc => {
    if (!Number.isFinite(wartosc) || Math.abs(wartosc) > MAX_ABS_VALUE) throw new Error('result_out_of_range');
    return wartosc;
  };

  function parsujPodstawowe() {
    if (biezacy()?.typ === 'number') return pobierz('number').wartosc;
    if (biezacy()?.typ === '(') {
      pobierz('(');
      glebokosc++;
      if (glebokosc > MAX_DEPTH) throw new Error('nesting_too_deep');
      const wartosc = parsujSume();
      pobierz(')');
      glebokosc--;
      return wartosc;
    }
    throw new Error('expected_number_or_parenthesis');
  }
  function parsujJednostkowe() {
    if (biezacy()?.typ === '+') { pobierz('+'); return parsujJednostkowe(); }
    if (biezacy()?.typ === '-') { pobierz('-'); return sprawdzWynik(-parsujJednostkowe()); }
    return parsujPodstawowe();
  }
  function parsujIloczyn() {
    let wartosc = parsujJednostkowe();
    while (biezacy()?.typ === '*' || biezacy()?.typ === '/') {
      const operator = tokeny[indeks++].typ;
      const prawa = parsujJednostkowe();
      if (operator === '/' && prawa === 0) throw new Error('division_by_zero');
      wartosc = sprawdzWynik(operator === '*' ? wartosc * prawa : wartosc / prawa);
    }
    return wartosc;
  }
  function parsujSume() {
    let wartosc = parsujIloczyn();
    while (biezacy()?.typ === '+' || biezacy()?.typ === '-') {
      const operator = tokeny[indeks++].typ;
      const prawa = parsujIloczyn();
      wartosc = sprawdzWynik(operator === '+' ? wartosc + prawa : wartosc - prawa);
    }
    return wartosc;
  }
  try {
    const wartosc = parsujSume();
    if (indeks !== tokeny.length) throw new Error('unexpected_token');
    const zaokraglona = Number(wartosc.toPrecision(15));
    return { ok: true, value: Object.is(zaokraglona, -0) ? 0 : zaokraglona };
  } catch (error) {
    return { ok: false, reason: error.message || 'invalid_expression' };
  }
}

function obliczPytanie(pytanie) {
  const wyrazenie = wyodrebnijWyrazenie(pytanie);
  if (!wyrazenie) return { ok: false, reason: 'invalid_expression' };
  return { ...obliczWyrazenie(wyrazenie), expression: wyrazenie };
}

function czyPytanieObliczeniowe(pytanie) {
  if (typeof pytanie !== 'string' || pytanie.length > 500) return false;
  // Jawna komenda z liczbą i operatorem pozostaje obliczeniem także wtedy,
  // gdy samo wyrażenie jest błędne (np. dzielenie przez zero). Nie wolno
  // wtedy przekazywać go do LLM jako zwykłego pytania.
  const match = pytanie.trim().match(/^(?:oblicz|policz|ile\s+to|ile\s+wynosi|wynik\s+dzia[lł]ania)\s*[:=]?\s*(.*)$/iu);
  if (!match) return false;
  const tresc = match[1];
  return /\d/u.test(tresc) && /[+*/×÷-]/u.test(tresc);
}

function formatujWynik(wartosc) {
  return String(wartosc).replace('.', ',');
}

module.exports = { obliczWyrazenie, obliczPytanie, czyPytanieObliczeniowe, formatujWynik };
