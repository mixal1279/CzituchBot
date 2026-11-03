'use strict';
// Regresje dla przypadkow false-rejection z live benchmarku (P0):
// comparison-337, why-005, why-006, quantity-285, oraz P1 (where-173, how-061).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  spojnoscTlumaczeniaClaimu,
  pojeciaCrossLanguage,
  czyTlumaczenieOdwracaRelacjeKorupcjiWheatleya,
  zbudujWyroczniaNazw,
  KNOWN_ENTITY_ALIAS_PATTERNS,
  wyglądaNaAngielski,
  wyodrebnijJednostkoweWartosci,
  zgodnoscStrukturalna,
  wyodrebnijNazwyWlasne,
} = require('../ai/claimValidation');
const { normalizujWynikWalidatora } = require('../ai/validator');
const { detectOverclaimTypes } = require('../ai/claim-support');

function wynikModelu(claim, quote, claimEn) {
  return {
    valid: true,
    reason: 'ok',
    unsupported_claims: [],
    supported: true,
    relevant: true,
    complete: true,
    hallucination: false,
    confidence: 0.95,
    claims: [{ claim, supported: true, source_ids: ['SOURCE 1'], evidence_quote: quote, claim_en: claimEn }],
  };
}

function dane(tresc) {
  return '[SOURCE 1]\nTYTUŁ: Test\nTREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>\n' + tresc + '\n<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
}

test('wyglądaNaAngielski odróżnia krótki angielski tekst od polskiego tekstu bez diakrytyki', () => {
  assert.equal(wyglądaNaAngielski('The fight lasts five minutes.'), true);
  assert.equal(wyglądaNaAngielski('Walka trwa pięć minut.'), false);
  assert.equal(wyglądaNaAngielski('Walka trwa piec minut.'), false);
});

test('jednostki zachowują polskie znaki w surowym tekście', () => {
  assert.deepEqual(wyodrebnijJednostkoweWartosci('Koszt wynosi 50 zł, a wydarzenie trwa 1 dzień i 2 godzinę.'), [
    '50:pln', '1:day', '2:hour',
  ]);
});

test('jeśli i jeżeli nie zamieniają negacji warunku w negację głównego twierdzenia', () => {
  for (const marker of ['Jeśli', 'Jeżeli']) {
    const evidence = `${marker} nie wybrano A, to B występuje.`;
    assert.equal(zgodnoscStrukturalna(evidence, 'B występuje.').ok, true);
    assert.equal(zgodnoscStrukturalna('B występuje.', `${marker} nie wybrano A, to B występuje.`).ok, false);
  }
  assert.equal(zgodnoscStrukturalna('Jeśli wybrano A, to B występuje.', 'B występuje.').ok, true);
  assert.equal(zgodnoscStrukturalna('A występuje, ale B nie występuje.', 'A występuje, ale B nie występuje.').ok, true);
});

test('polskie wielkie litery Ł i Ś pozostają rozpoznawalne jako nazwy własne', () => {
  assert.deepEqual(wyodrebnijNazwyWlasne('Łowca odwiedza Świątynię.', { nameOracle: new Set(['łowca', 'świątynię']) }), [
    'łowca', 'swiatynie',
  ]);
});

test('and ... without ... nie usuwa negacji głównego twierdzenia', () => {
  const evidence = 'Astarion escapes and does not die without help.';
  assert.equal(zgodnoscStrukturalna(evidence, evidence).ok, true);
  assert.equal(zgodnoscStrukturalna(evidence, 'Astarion escapes and dies without help.').ok, false);
});

// --- quantity-285 / comparison-337: claim_en kopiuje cytat, ale pojecia spoza
// slownika narracyjnego (czas trwania, szerokosc w pikselach) nie daja zadnego
// trafienia w pojeciaCrossLanguage po zadnej stronie. Pusty zbior pojec po obu
// stronach nie jest sygnalem sprzecznosci — to po prostu temat spoza slownika.

test('quantity-285: claim_en kopiujacy cytat o czasie trwania kampanii przechodzi, gdy zadna strona nie ma pojec ze slownika', () => {
  const quote = 'The main campaign of Portal 2 takes around 8 to 10 hours to complete for an average player, though speedrunners can finish it much faster.';
  const claimPl = 'Uko\u0144czenie kampanii fabularnej Portal 2 zajmuje oko\u0142o 8 do 10 godzin.';
  assert.deepEqual([...pojeciaCrossLanguage(claimPl)], []);
  // „Uko\u0144czenie” to pierwsze slowo zdania — bez wyroczni nazw (budowanej w
  // prawdziwym pipeline ze zrodel) kazdy token na poczatku zdania liczy sie
  // jako potencjalna nazwa wlasna (patrz test/ai-validator-sentence-initial-words.test.js).
  // Tu przekazujemy wyrocznie zbudowana z tego samego zrodla, tak jak robi to
  // ai/validator.js, zeby test odzwierciedlal rzeczywisty pipeline.
  const nameOracle = zbudujWyroczniaNazw([{ content: quote }]);
  const wynik = spojnoscTlumaczeniaClaimu(claimPl, quote, { evidenceQuote: quote, nameOracle });
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});

test('comparison-337: claim_en kopiujacy cytat porownujacy szerokosc ramion Steve/Alex przechodzi mimo braku pojec w slowniku', () => {
  const quote = "Steve's model uses the classic arms that are 4 pixels wide, while Alex's model uses slim arms that are only 3 pixels wide, which is the main visual difference between the two default skins.";
  const claimPl = 'Steve ma ramiona szeroko\u015bci 4 pikseli, a Alex ma ramiona szeroko\u015bci 3 pikseli.';
  const wynik = spojnoscTlumaczeniaClaimu(claimPl, quote, { evidenceQuote: quote });
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});

// Ten sam mechanizm nie moze zaczac ignorowac realnych sprzecznosci: gdy
// SLOWNIK rozpoznaje pojecie po jednej stronie, a nie po drugiej, odrzucenie
// musi zostac zachowane (test regresyjny dla istniejacego zachowania).
test('pusty zbior pojec po jednej stronie nadal nie maskuje realnej rozbieznosci, gdy druga strona ma pojecie', () => {
  const quote = 'Geralt was born in the city.';
  const claimPl = 'Geralt odwiedza miasto.';
  const wynik = spojnoscTlumaczeniaClaimu(claimPl, quote, { evidenceQuote: quote });
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /kopiuje cytat/);
});

// --- why-005: polski bezokolicznik dokonany „uciec” nie byl lapany przez
// wzorzec pojecia 'poscig' (lapal tylko rodzine „uciekac”), wiec angielskie
// „escape” w cytacie wygladalo jak dodane pojecie.

test("why-005: polskie \u201euciec\u201d i angielskie \u201eescape\u201d sa rozpoznawane jako to samo pojecie (poscig)", () => {
  const claimPl = 'Astarion do\u0142\u0105cza do dru\u017cyny, aby uciec przed swoim dawnym panem Cazadorem.';
  assert.ok(pojeciaCrossLanguage(claimPl).has('poscig'), 'claim z \u201euciec\u201d powinien dawa\u0107 pojecie poscig');
});

test('why-005: claim_en kopiujacy dluzszy cytat o ucieczce Astariona od Cazadora przechodzi', () => {
  const quote = 'Astarion joins the party in an attempt to escape his abusive former master, Cazador Szarr, and track down a way to regain his agency without succumbing fully to his vampiric urges.';
  const claimPl = 'Astarion do\u0142\u0105cza do dru\u017cyny, aby uciec przed swoim dawnym panem Cazadorem.';
  const wynik = spojnoscTlumaczeniaClaimu(claimPl, quote, { evidenceQuote: quote });
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});

// --- why-006: funkcja detectOverclaimTypes w ai/claim-support.js utrzymywala
// wlasna, osobna liste znacznikow przyczynowych, ktora rozjechala sie z
// CAUSAL_RE/CAUSAL_EVIDENCE_RE z ai/claimValidation.js (brakowalo m.in.
// „corrupt”), wiec poprawny, wsparty dowodem claim przyczynowy przechodzil
// glowna kontrole dowodu, ale i tak byl odrzucany jako „correlation_to_causation”.

test('why-006: claim-support audit nie zglasza correlation_to_causation dla „corrupt”, bo korzysta ze wspolnej listy znacznikow', () => {
  const types = detectOverclaimTypes(
    'Wheatley takes control of GLaDOS because the sudden influx of power corrupts him.',
    'The sudden influx of power corrupts him and he seizes full control of the facility.',
  );
  assert.ok(!types.includes('correlation_to_causation'), JSON.stringify(types));
});

test('why-006: pelny pipeline waliduje przyczynowy claim o przejeciu kontroli przez Wheatleya (wspierany przez cytat o korupcji wladza)', () => {
  const quote = 'Wheatley is installed as the new primary core in place of GLaDOS, but the sudden influx of power corrupts him and he seizes full control of the Aperture Science facility.';
  const claimPl = 'Wheatley przejmuje kontrol\u0119 nad GLaDOS, poniewa\u017c zostaje zainstalowany jako nowy rdze\u0144 zarz\u0105dzaj\u0105cy obiektem, co nieoczekiwanie daje mu pe\u0142n\u0105 w\u0142adz\u0119 nad Aperture.';
  const claimEn = 'Wheatley takes control of GLaDOS because he is installed as the new primary core managing the facility, which unexpectedly gives him full control of Aperture.';
  const payload = wynikModelu(claimPl, quote, claimEn);
  const result = normalizujWynikWalidatora(
    payload, 'test-model', 'test', new Set(['SOURCE 1']), dane(quote), claimPl,
    { question: 'Dlaczego Wheatley przej\u0105\u0142 kontrol\u0119 nad GLaDOS?' },
  );
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
});

// claim z odwrocona relacja: zabezpieczenie przed zamiana nastepstwa na
// przyczyne musi pozostac — korupcja wladza jest przyczyna przejecia kontroli,
// nie odwrotnie (analogicznie do istniejacego testu Thu'um/pochlaniania dusz).
test('why-006: tlumaczenie odwracajace kierunek „korupcja → kontrola” na „kontrola → korupcja” jest odrzucane', () => {
  const claimPl = 'Wheatley zostaje skorumpowany przez w\u0142adz\u0119, przez co przejmuje pe\u0142n\u0105 kontrol\u0119 nad obiektem Aperture.';
  const claimEnReversed = 'Wheatley takes full control of the Aperture facility, which corrupts him with power.';
  assert.equal(czyTlumaczenieOdwracaRelacjeKorupcjiWheatleya(claimPl, claimEnReversed), true);
  const wynik = spojnoscTlumaczeniaClaimu(claimPl, claimEnReversed);
  assert.equal(wynik.ok, false);
  assert.match(wynik.reason, /odwraca relacj\u0119/);
});

test('why-006: wierne tlumaczenie kierunku „korupcja → kontrola” nadal przechodzi', () => {
  const claimPl = 'Wheatley zostaje skorumpowany przez w\u0142adz\u0119, przez co przejmuje pe\u0142n\u0105 kontrol\u0119 nad obiektem Aperture.';
  const claimEnCorrect = 'Wheatley becomes corrupted by power, which causes him to take full control of the Aperture facility.';
  assert.equal(czyTlumaczenieOdwracaRelacjeKorupcjiWheatleya(claimPl, claimEnCorrect), false);
  const wynik = spojnoscTlumaczeniaClaimu(claimPl, claimEnCorrect);
  assert.equal(wynik.ok, true, JSON.stringify(wynik));
});

// --- where-173: generyczny inflektor tokenow w ai/entityAliases.js nie
// obslugiwal nieregularnej polskiej fleksji rzeczownikow zenskich na „-ja”
// (zbroja -> zbroi, nigdy „zbroji”), wiec dopelniacz „zbroi szkoly Kota” nie
// dopasowywal aliasu „Cat School Gear” i „Kota” wypadalo jako rzekomo
// zgubiona nazwa wlasna.

test('where-173: dope\u0142niacz „zbroi szko\u0142y Kota” dopasowuje alias Cat School Gear tak samo jak mianownik', () => {
  const alias = KNOWN_ENTITY_ALIAS_PATTERNS.find(a => a.canonical === 'feline armor');
  assert.equal(alias.pattern.test('zbroi szkoly kota'), true);
  assert.equal(alias.pattern.test('zbroja szkoly kota'), true);
});

test('where-173: pelny pipeline waliduje claim o diagramach zbroi szkoly Kota (dope\u0142niacz w claimie)', () => {
  const quote = 'Diagrams for the Cat School gear can be found scattered around Novigrad and in the area near Oxenfurt.';
  const claimPl = 'Diagramy zbroi szko\u0142y Kota mo\u017cna znale\u017a\u0107 w Novigradzie oraz w okolicach Oxenfurtu.';
  const payload = wynikModelu(claimPl, quote, quote);
  const result = normalizujWynikWalidatora(
    payload, 'test-model', 'test', new Set(['SOURCE 1']), dane(quote), claimPl,
    { question: 'Gdzie znale\u017a\u0107 zbroj\u0119 szko\u0142y Kota?' },
  );
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
});

// --- how-061: wzorzec pojecia 'atak' nie obejmowal polskiego czasownika
// dokonanego z przedrostkiem „za-” („zaatakuje”), a brakujace pojecie-encja
// typu 'shulker' nie korzystalo z juz istniejacego mechanizmu wiazania
// zaimka anaforycznego w cytacie do nazwy z TEGO SAMEGO zdania (mechanizm ten
// juz istnial dla zwyklych nazw wlasnych — patrz
// test/ai-validator-regex-regressions.test.js — ale nie obejmowal pojec
// ze slownika pojeciaCrossLanguage).

test('how-061: polskie „zaatakuje” jest rozpoznawane jako pojecie atak, tak samo jak „atakuje”', () => {
  assert.ok(pojeciaCrossLanguage('Shulker zaatakuje gracza').has('atak'));
  assert.ok(pojeciaCrossLanguage('Shulker atakuje gracza').has('atak'));
});

test('how-061: zaimek w cytacie wiazacy sie z nazwa/pojeciem-encja z TEGO SAMEGO zdania jest akceptowany', () => {
  const fullSource = 'A shulker guards the loot chest, and it will attack any player who gets too close.';
  const quote = 'it will attack any player who gets too close.';
  const claimPl = 'Shulker zaatakuje ka\u017cdego gracza, kt\u00f3ry podejdzie zbyt blisko.';
  const payload = wynikModelu(claimPl, quote, quote);
  const result = normalizujWynikWalidatora(
    payload, 'test-model', 'test', new Set(['SOURCE 1']), dane(fullSource), claimPl,
    { question: 'Jak zdoby\u0107 elytr\u0119?' },
  );
  assert.equal(result.status, 'accepted', JSON.stringify(result.diagnostics));
});

// Zabezpieczenie nienaruszone: gdy w TYM SAMYM zdaniu co cytat jest INNY,
// konkurencyjny kandydat na referenta zaimka, wiazanie z encja z poprzedniego
// zdania musi pozostac odrzucone (ten sam wzorzec co istniejacy test
// „anaphoric quote binds the claimed name only within the same sentence”).
test('how-061: konkurencyjny kandydat w tym samym zdaniu nadal blokuje wiazanie z poprzedniego zdania', () => {
  const claimPl = 'Shulker zaatakuje gracza.';
  const wynik = spojnoscTlumaczeniaClaimu(claimPl, 'it will attack the player', {
    evidenceQuote: 'it will attack the player',
    evidenceContext: 'A shulker guards the chest. An enderman, which guards the portal, it will attack the player.',
  });
  assert.equal(wynik.ok, false);
});

// „purpose relation” (relacja celu): sam cel nie dowodzi dokonanego skutku —
// to zachowanie juz istnieje w walidatorze (quoteStatesPurpose /
// quoteStatesCompletedOutcome w ai/validator.js) i nie zostalo tu naruszone;
// regresja potwierdzajaca to zachowanie juz istnieje w
// test/ai-claim-translation-diagnostics.test.js („a source saying a shulker
// guards elytra does not prove it must be killed” — analogiczny wzorzec celu
// bez potwierdzonego skutku).
