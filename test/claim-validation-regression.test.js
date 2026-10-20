'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  wyodrebnijNazwyWlasne,
  zbudujWyroczniaNazw,
  dopasowanieSemantyczne,
  zgodnoscStrukturalna,
  sprawdzSprzecznosciSemantyczne,
  sprawdzTwardeKonflikty,
  spojnoscTlumaczeniaClaimu,
} = require('../ai/claimValidation');

test('sentence-initial generic words are not treated as proper names', () => {
  for (const claim of [
    'Decyzja ta wynikała z wcześniejszych wydarzeń.',
    'Motywuje go to do dalszego działania.',
    'Nowo uzyskana potęga zmienia sytuację.',
    'Aby rozpocząć romans, zwiększ poziom aprobaty.',
    'Dodatkowo pojawia się nowa, ważna postać.',
  ]) {
    assert.deepEqual(wyodrebnijNazwyWlasne(claim), []);
  }
});

test('diacritics-normalized generic first words are not extracted as names', () => {
  assert.equal(wyodrebnijNazwyWlasne('Był manicznie szczęśliwy…').includes('byl'), false);
  assert.equal(wyodrebnijNazwyWlasne('Najpierw użyj krzyku Dragonrend…').includes('najpierw'), false);
  assert.equal(wyodrebnijNazwyWlasne('Kontynuuj ataki…').includes('kontynuuj'), false);
  assert.equal(wyodrebnijNazwyWlasne('Nie ma potwierdzenia…').includes('nie'), false);
});

test('real first-word names Artur and Arthur remain detectable', () => {
  assert.ok(wyodrebnijNazwyWlasne('Artur opuścił miasto.').includes('artur'));
  assert.ok(wyodrebnijNazwyWlasne('Arthur opuścił miasto.').includes('arthur'));
  assert.ok(wyodrebnijNazwyWlasne('Dodatkowo Alex ma zielone oczy.').includes('alex'));
});

test('name oracle preserves source-backed sentence-initial names and filters ordinary Polish starters', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: '…and Wheatley is put in its place…' }]);
  assert.ok(wyodrebnijNazwyWlasne('Wheatley przejął kontrolę.', { nameOracle }).includes('wheatley'));
  const ordinary = wyodrebnijNazwyWlasne('Miecz znajduje się w wózku. Najpierw użyj Dragonrend.', { nameOracle });
  assert.equal(ordinary.includes('miecz'), false);
  assert.equal(ordinary.includes('najpierw'), false);
  assert.deepEqual([...nameOracle], ['wheatley']);
});

test('name oracle matches Polish inflection variants of source-backed names', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: '…and Wheatley is put in its place…' }]);
  assert.ok(wyodrebnijNazwyWlasne('Wheatleya opisano w źródle.', { nameOracle }).includes('wheatleya'));
  assert.ok(zbudujWyroczniaNazw([{ content: 'The source names Wheatley.' }]).has('wheatley'));
  const extras = zbudujWyroczniaNazw([], ['Bloody Baron']);
  assert.ok(extras.has('bloody'));
  assert.ok(extras.has('baron'));
});

test('known limitation: an invented sentence-initial name is ignored, while an internal acronym remains a name', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: 'GLaDOS was discussed later in the source.' }]);
  const names = wyodrebnijNazwyWlasne('Zorblax usunął głowę GLaDOS.', { nameOracle });
  assert.equal(names.includes('zorblax'), false);
  assert.equal(names.includes('glados'), true);
});

test('semantic matching reports ignored sentence-initial names for benchmark diagnostics', () => {
  const nameOracle = zbudujWyroczniaNazw([{ content: '…and Wheatley is put in its place…' }]);
  const result = dopasowanieSemantyczne(
    'Wheatley controls the facility.',
    'Zorblax controls the facility.',
    { nameOracle },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.ignoredSentenceInitialNames, ['Zorblax']);
});

test('apostrophe and Polish inflection variants match source name tokens', () => {
  const result = zgodnoscStrukturalna(
    'Johnny Silverhand jest znanym najemnikiem z Night City.',
    'Johnny’ego Silverhanda opisano jako znanego najemnika.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('generic sentence start no longer causes a false proper-name rejection', () => {
  const result = zgodnoscStrukturalna(
    'Decyzja ta wynikała z wcześniejszych wydarzeń w systemie.',
    'Decyzja ta wynikała z wcześniejszych wydarzeń w systemie.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('semantic paraphrase remains possible when a supported concept and entity match', () => {
  const result = zgodnoscStrukturalna(
    'Wheatley przejmuje kontrolę nad GLaDOS w komorze testowej.',
    'Wheatley zdobywa kontrolę nad GLaDOS w komorze testowej.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('Polish localized Elden Ring weapon name aliases to the English Greatsword entity', () => {
  const { wyodrebnijNazwyWlasne: extractNames } = require('../ai/claimValidation');
  assert.deepEqual(extractNames('Wielki Miecz znajduje się w Caelid.'), ['greatsword', 'caelid']);
  const result = zgodnoscStrukturalna(
    'The Greatsword can be found in Caelid.',
    'Wielki Miecz można znaleźć w Caelid.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('numeric/date conflicts remain hard failures', () => {
  const result = zgodnoscStrukturalna(
    'Wheatley przejął kontrolę w 2011 roku.',
    'Wheatley przejął kontrolę w 2012 roku.',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /liczbę\/datę/);
});

test('negation mismatch remains a hard failure', () => {
  const result = zgodnoscStrukturalna(
    'Arthur nie zabił strażnika.',
    'Arthur zabił strażnika.',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /negację/);
});

test('rhetorical "do not forget" does not invert the polarity of a factual claim', () => {
  const evidence = 'Nie możemy zapomnieć o naszych wiernych towarzyszach podróży - w akcie pierwszym możemy zrekrutować szóstkę fantastycznych kolegów i koleżanek, w tym Astariona.';
  const claim = 'Astarion jest jednym z sześciu początkowych towarzyszy.';
  const result = sprawdzTwardeKonflikty(evidence, claim);
  assert.equal(result.ok, true, result.reason);
});

test('lack of stability is a negative noun phrase, not negation of the destruction event', () => {
  const result = sprawdzTwardeKonflikty(
    "Wheatley's lack of stability is going to cause the destruction of Aperture Science.",
    "Wheatley's instability will cause the destruction of Aperture Science.",
  );
  assert.equal(result.ok, true, result.reason);
});

test('English damage vocabulary does not create a false semantic conflict and zero damage still supports reduction', () => {
  const evidence = "You'll take no damage from their breath when blocking. You can kill dragons.";
  const claim = 'Blokowanie redukuje obrażenia od ich oddechu.';
  assert.equal(sprawdzSprzecznosciSemantyczne(evidence, claim).ok, true);
  assert.equal(sprawdzTwardeKonflikty(evidence, claim).ok, true);
});

test('decimal values normalize across comma and trailing-zero formats', () => {
  const result = sprawdzTwardeKonflikty('The blade weighs 2.5 kg.', 'The blade weighs 2,50 kg.');
  assert.equal(result.ok, true, result.reason);
});

test('claim_en cannot translate killing as capture or reduction as increase', () => {
  const killedAsCaptured = spojnoscTlumaczeniaClaimu('Wheatley zabił Chella.', 'Wheatley captured Chell.');
  assert.equal(killedAsCaptured.ok, false);
  assert.match(killedAsCaptured.reason, /zdarzenie|relację/);

  const reducedAsIncreased = spojnoscTlumaczeniaClaimu('Dragonrend zmniejsza obrażenia od ognia.', 'Dragonrend increases fire damage.');
  assert.equal(reducedAsIncreased.ok, false);
  assert.match(reducedAsIncreased.reason, /redukcji|ochrony/);
});

test('claim_en cannot drop a causal relation but purpose clauses are not causal claims', () => {
  const droppedCause = spojnoscTlumaczeniaClaimu('Wheatley przejął kontrolę, ponieważ chciał uciec.', 'Wheatley took control.');
  assert.equal(droppedCause.ok, false);
  assert.match(droppedCause.reason, /przyczynową/);

  const purposeTranslation = spojnoscTlumaczeniaClaimu(
    'Dragonborn używa krzyku, aby wchłonąć duszę smoka.',
    'The Dragonborn uses the shout to absorb the dragon soul.',
  );
  assert.equal(purposeTranslation.ok, true, purposeTranslation.reason);
});

test('English purpose clauses do not trigger the unsupported-causal hard gate', () => {
  for (const purpose of ['in order to', 'so that he can']) {
    const result = zgodnoscStrukturalna(
      'The Dragonborn uses Dragonrend to absorb the dragon soul.',
      `The Dragonborn uses Dragonrend ${purpose} absorb the dragon soul.`,
    );
    assert.equal(result.ok, true, `${purpose}: ${result.reason}`);
  }
});

test('English lack of and absence of remain negations in the hard gate', () => {
  for (const evidence of ['There is a lack of siblings.', 'There is an absence of siblings.']) {
    const result = sprawdzTwardeKonflikty(evidence, 'He has siblings.');
    assert.equal(result.ok, false, evidence);
    assert.match(result.reason, /negację/);
  }
});

test('the zero-quantifier exception does not erase an unrelated no-siblings conflict', () => {
  const result = sprawdzTwardeKonflikty('He has no siblings.', 'Ma rodzeństwo.');
  assert.equal(result.ok, false);
  assert.match(result.reason, /negację/);
});

test('Polish inflection "spowoduje" is recognized as an explicit causal relation', () => {
  const result = zgodnoscStrukturalna(
    'Brak stabilności Wheatleya spowoduje zniszczenie Aperture.',
    'Brak stabilności Wheatleya doprowadzi do zniszczenia Aperture.',
  );
  assert.equal(result.ok, true, result.reason);
});

test('unsupported causal relation remains a hard failure', () => {
  const result = zgodnoscStrukturalna(
    'Wheatley przejął kontrolę nad systemem.',
    'Wheatley przejął kontrolę nad systemem, ponieważ chciał uciec.',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /przyczynową/);
});

test('one shared concept cannot cover a sentence that adds multiple unsupported events', () => {
  const { sprawdzPokrycieClaimamiOdpowiedzi } = require('../ai/claimValidation');
  const result = sprawdzPokrycieClaimamiOdpowiedzi(
    'Arthur betrayed Dutch, rescued John, and ended the conflict with Micah.',
    [{ claim: 'Arthur betrayed Dutch.' }],
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.uncoveredSentenceIndexes, [0]);
});

test('English causal relation markers remain hard failures when evidence lacks the cause', () => {
  for (const marker of ['led to', 'resulted in', 'as a result']) {
    const result = zgodnoscStrukturalna(
      'Wheatley took control of the system.',
      'Wheatley took control of the system, which ' + marker + ' his escape.',
    );
    assert.equal(result.ok, false, marker + ': ' + result.reason);
    assert.match(result.reason, /przyczynow|semantyczn|pokrycie/i);
  }
});

test('purpose clauses are not misclassified as unsupported causal relations', () => {
  const cases = [
    [
      'Astarion chce przeżyć jego historię.',
      'Astarion chce, aby przeżyć jego historię.',
    ],
    [
      'Dragonborn używa krzyku, by wchłonąć duszę smoka.',
      'Dragonborn używa krzyku, aby wchłonąć duszę smoka.',
    ],
  ];
  for (const [evidence, claim] of cases) {
    const result = zgodnoscStrukturalna(evidence, claim, { allowCrossLanguageExactEvidence: true });
    assert.equal(result.ok, true, result.reason);
  }
});
