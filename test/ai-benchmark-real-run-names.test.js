'use strict';
// Regresje z realnego runu benchmarku (ff3f942): lokalizowane nazwy i odmiany nazw
// nie mogą być odrzucane jako „tłumaczenie claimu gubi nazwy własne”.
const test = require('node:test');
const assert = require('node:assert');
const { spojnoscTlumaczeniaClaimu } = require('../ai/claimValidation');

const PAIRS = [
  ['Wheatley, znany również jako Sfera Ograniczająca Inteligencję, to rdzeń osobowości o męskim programowaniu.',
    'Wheatley, also known as the Intelligence Dampening Sphere, is a personality core with masculine programming.'],
  ['Jest drugim głównym bohaterem gry, pomagającym Chell w ucieczce z Centrum Wzbogacania Aperture Science.',
    "He is the game's deuteragonist, aiding Chell in escaping the Aperture Science Enrichment Center."],
  ['Przed wydarzeniami z Portal 2 odpowiedzialny był za utrzymanie Centrum Rozluźnienia.',
    'Prior to the events of Portal 2, Wheatley was put in charge of maintaining the Extended Relaxation Center.'],
  ['Silverhand walczył przeciwko skorumpowanemu rządowi USA oraz megakorporacjom.',
    'Silverhand fought against the corrupt US government and megacorporations.'],
  ['W niektórych zakończeniach V może zdecydować się na współpracę z Johnnym.',
    'In some endings, V can choose to cooperate with Johnny.'],
  ['W innym zakończeniu V może pozwolić Johnnemu przejąć kontrolę nad swoim ciałem.',
    'In another ending, V can let Johnny take control of their body.'],
];

for (const [pl, en] of PAIRS) {
  test('lokalizowana nazwa nie jest „zgubiona”: ' + pl.slice(0, 50), () => {
    const result = spojnoscTlumaczeniaClaimu(pl, en);
    assert.doesNotMatch(String(result.reason || ''), /gubi nazwy własne/, JSON.stringify(result));
  });
}

test('prawdziwie zgubiona nazwa własna dalej jest wykrywana', () => {
  const result = spojnoscTlumaczeniaClaimu(
    'Wheatley pomaga Chell w ucieczce z Centrum Wzbogacania Aperture Science.',
    'He helps her escape the facility.',
  );
  assert.equal(result.ok, false, JSON.stringify(result));
});
