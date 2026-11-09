'use strict';

const { performance } = require('node:perf_hooks');
const { normalizeEvidenceText } = require('../ai/evidence');
const {
  KNOWN_ENTITY_ALIAS_PATTERNS,
  CAUSAL_RE,
  spojnoscTlumaczeniaClaimu,
} = require('../ai/claimValidation');

const wyniki = [];

function zmierz(nazwa, wejscie, operacja) {
  const start = performance.now();
  operacja(wejscie);
  wyniki.push({ nazwa, dlugosc: wejscie.length, ms: Number((performance.now() - start).toFixed(2)) });
}

for (const limit of [1000, 4000, 12000]) {
  const markdown = ('[etykieta](https://example.test/a(b)c) ![obraz](https://example.test/x) '.repeat(Math.ceil(limit / 70))).slice(0, limit);
  zmierz('markdown', markdown, normalizeEvidenceText);

  const aliasy = ('nieznana-encja-i-losowy-tekst-').repeat(Math.ceil(limit / 30)).slice(0, limit);
  zmierz('aliasy', aliasy, tekst => {
    for (const entry of KNOWN_ENTITY_ALIAS_PATTERNS) entry.pattern.test(tekst);
  });

  const przyczynowosc = ('because causally resulting in an unrelated outcome ').repeat(Math.ceil(limit / 52)).slice(0, limit);
  zmierz('causal', przyczynowosc, tekst => CAUSAL_RE.test(tekst));
}

for (const liczba of [20, 60, 100]) {
  const fragment = 'and ' + 'alpha '.repeat(liczba) + 'without ' + 'beta '.repeat(liczba);
  const tekst = fragment.slice(0, 1000);
  zmierz('negacja', tekst, value => spojnoscTlumaczeniaClaimu(value, value));
}

process.stdout.write(JSON.stringify(wyniki));
