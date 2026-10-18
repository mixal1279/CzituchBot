'use strict';

const fs = require('fs');

const PIEKARZ_CACHE_FILE = './piekarz_stream_cache.json';
const KAJZERKA_CACHE_FILE = './kajzerka_billy_cache.json';

function loadCache(file) {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[Bułka] Nie udało się odczytać cache ' + file + ': ' + err.message);
  }
  return {};
}

function saveCache(file, cache) {
  try {
    fs.writeFileSync(file, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('[Bułka] Nie udało się zapisać cache ' + file + ': ' + err.message);
  }
}

const piekarzCache = loadCache(PIEKARZ_CACHE_FILE);
const kajzerkaCache = loadCache(KAJZERKA_CACHE_FILE);

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function choose(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function chooseByPercent(rng, ordinary, rare, legendary) {
  const roll = rng() * 100;
  if (roll < 89) return choose(ordinary, rng);
  if (roll < 99) return choose(rare, rng);
  return choose(legendary, rng);
}

const ZAKWASZE_KOMENTARZE = [
  { min: 0, max: 19, text: 'Suchy jak wiór. Przydałoby się trochę wody i cierpliwości.' },
  { min: 20, max: 39, text: 'Zakwas ledwo pracuje. Jeszcze trochę i może coś z tego będzie.' },
  { min: 40, max: 59, text: 'Fermentacja przebiega prawidłowo. Bułka jest dobrej myśli.' },
  { min: 60, max: 79, text: 'Ależ to rośnie! Piekarz może być dumny.' },
  { min: 80, max: 99, text: 'Prawdziwy rzemieślniczy zakwas. Klasa sama w sobie!' },
];

function rollZakwas(rng = Math.random) {
  const value = randomInt(rng, 0, 100);
  if (value === 100) {
    return {
      value,
      comment: 'ALARM PIEKARNICZY! Zakwas wymknął się spod kontroli i właśnie przejął piekarnię!',
      special: true,
    };
  }
  const band = ZAKWASZE_KOMENTARZE.find((item) => value >= item.min && value <= item.max);
  return { value, comment: band.text, special: false };
}

const SWIEZOSC_KOMENTARZE = [
  { min: 0, max: 19, text: 'Wczorajsza bułka, ale nadal nadajesz się do kanapek!' },
  { min: 20, max: 39, text: 'Trochę poleżałeś na półce, ale nie jest źle.' },
  { min: 40, max: 59, text: 'Całkiem świeża bułeczka. Można śmiało chrupać!' },
  { min: 60, max: 79, text: 'Świeżutki wypiek! Piekarz jest zadowolony.' },
  { min: 80, max: 100, text: 'Prosto z pieca! Jeszcze cieplutki wypiek premium!' },
];

const PRZYPALENIE_KOMENTARZE = [
  { min: 0, max: 19, text: 'Ledwo muśnięty ciepłem piekarnika.' },
  { min: 20, max: 39, text: 'Lekko przypieczony. Tak dla chrupkości.' },
  { min: 40, max: 59, text: 'Złocisty kolor, ale piekarz powinien uważać.' },
  { min: 60, max: 79, text: 'Zaczyna pachnieć spalenizną. Kto pilnował pieca?!' },
  { min: 80, max: 100, text: 'ALARM! Ktoś zapomniał wyjąć bułkę z piekarnika!' },
];

function rollFromBands(bands, rng = Math.random) {
  const value = randomInt(rng, 0, 100);
  const band = bands.find((item) => value >= item.min && value <= item.max);
  return { value, comment: band.text };
}

const SMAKI = [
  'bułkę czosnkową', 'drożdżówkę z serem', 'rogala czekoladowego',
  'bułkę z sezamem', 'chleb na zakwasie', 'pączka z marmoladą',
  'bagietkę czosnkową', 'bułkę z serem', 'drożdżówkę z kruszonką',
  'chleb tostowy', 'precla', 'kajzerkę z szynką i serem',
  'chałkę z masłem', 'bułkę maślaną', 'focaccię z ziołami',
  'kajzerkę z bekonem', 'bułkę z miodem', 'bagietkę z mozzarellą',
];

const WYZWANIA_GOTOWE = [
  'Napij się trochę wody.', 'Przeciągnij się przez kilka sekund.',
  'Zrób krótką przerwę od ekranu.', 'Napisz komuś coś miłego.',
  'Wymyśl nazwę dla nowego rodzaju bułki.', 'Wymyśl absurdalny smak pieczywa.',
  'Przypomnij sobie jedną rzecz, z której jesteś dziś zadowolony.',
  'Zrób pięć spokojnych, głębokich oddechów.', 'Uśmiechnij się do siebie — nawet jeśli bez powodu.',
  'Wymyśl hasło reklamowe dla piekarni Bułki.', 'Przez chwilę rozluźnij ramiona.',
  'Pomyśl o jednej małej rzeczy, którą chcesz dziś zrobić.',
  'Wymyśl imię dla kajzerki-maskotki.', 'Opisz swój dzień nazwą pieczywa.',
  'Wymyśl nowy tytuł dla Naczelnego Testera Kajzerek.',
  'Zrób porządek z jedną małą rzeczą na biurku.',
  'Wybierz piosenkę, która pasuje do dzisiejszego nastroju.',
  'Przypomnij sobie coś, czego ostatnio się nauczyłeś.',
  'Wymyśl reklamę bułki, która kosztuje milion złotych.',
  'Pomyśl o miejscu, w którym dobrze odpoczywasz.',
  'Wymyśl nazwę dla piekarni na Marsie.',
  'Zrób chwilę przerwy i popatrz gdzieś poza ekran.',
  'Powiedz sobie jedną rzecz, którą robisz całkiem dobrze.',
  'Wymyśl najbardziej elegancką nazwę dla zwykłej kajzerki.',
  'Zaprojektuj w wyobraźni bułkę idealną.',
  'Wymyśl smak pieczywa, którego nikt nie odważyłby się spróbować.',
  'Napisz na czacie jedno pozytywne słowo.',
  'Wymyśl motto dla Inspektora Okruszków.',
  'Zastanów się, jaka bułka najlepiej opisuje twój charakter.',
  'Wymyśl nazwę dla tajnego wypieku BillyBulki.',
  'Przypomnij sobie zabawną sytuację z ostatnich dni.',
  'Zrób kilka kroków, jeśli masz taką możliwość.',
  'Pomyśl o jednej rzeczy, na którą czekasz z przyjemnością.',
  'Wymyśl supermoc dla piekarza.',
  'Opisz idealne śniadanie w trzech słowach.',
  'Wymyśl nazwę dla kajzerki z pięcioma rodzajami sera.',
  'Zaprojektuj logo dla fikcyjnej piekarni.',
  'Wymyśl najdziwniejszą nazwę dla chleba.',
  'Pomyśl o małej rzeczy, za którą możesz sobie podziękować.',
  'Wymyśl nowy zawód w piekarni.',
  'Zaproponuj nową kategorię do piekarniczego horoskopu.',
  'Wymyśl dialog pomiędzy kajzerką a bagietką.',
  'Nazwij wypiek, który byłby królem wszystkich kanapek.',
  'Wymyśl krótką rymowankę o chlebie.',
  'Opisz piekarnię, w której wszystko jest zrobione z bułek.',
  'Wymyśl imię dla zakwasu, który ma własny charakter.',
  'Zaprojektuj kanapkę dla kosmity.',
  'Wymyśl nagrodę dla najbardziej lojalnej mordki.',
  'Wymyśl nazwę dla bułki, która zawsze się spóźnia.',
  'Przez chwilę odłóż to, co robisz, i odpocznij bez presji.',
];

const WYZWANIA_GENERATOR = [
  { item: 'nowej kajzerki', subject: 'nowa kajzerka', genitive: 'nowej kajzerki' },
  { item: 'bułki z najbardziej absurdalnym nadzieniem', subject: 'bułka z najbardziej absurdalnym nadzieniem', genitive: 'bułki z najbardziej absurdalnym nadzieniem' },
  { item: 'piekarni na Księżycu', subject: 'piekarnia na Księżycu', genitive: 'piekarni na Księżycu' },
  { item: 'kanapki dla króla', subject: 'kanapka dla króla', genitive: 'kanapki dla króla' },
  { item: 'wypieku, którego nikt nie odważy się spróbować', subject: 'wypiek, którego nikt nie odważy się spróbować', genitive: 'wypieku, którego nikt nie odważy się spróbować' },
  { item: 'nowego smaku chleba', subject: 'nowy smak chleba', genitive: 'nowego smaku chleba' },
  { item: 'bułkowego superbohatera', subject: 'bułkowy superbohater', genitive: 'bułkowego superbohatera' },
  { item: 'piekarnika przyszłości', subject: 'piekarnik przyszłości', genitive: 'piekarnika przyszłości' },
  { item: 'najdziwniejszej drożdżówki', subject: 'najdziwniejsza drożdżówka', genitive: 'najdziwniejszej drożdżówki' },
  { item: 'maskotki piekarni', subject: 'maskotka piekarni', genitive: 'maskotki piekarni' },
  { item: 'kajzerki, która potrafi mówić', subject: 'kajzerka, która potrafi mówić', genitive: 'kajzerki, która potrafi mówić' },
  { item: 'kanapki z kosmosu', subject: 'kanapka z kosmosu', genitive: 'kanapki z kosmosu' },
  { item: 'bułki dla podróżników w czasie', subject: 'bułka dla podróżników w czasie', genitive: 'bułki dla podróżników w czasie' },
  { item: 'tajnego przepisu BillyBulki', subject: 'tajny przepis BillyBulki', genitive: 'tajnego przepisu BillyBulki' },
  { item: 'chleba o legendarnie chrupiącej skórce', subject: 'chleb o legendarnie chrupiącej skórce', genitive: 'chleba o legendarnie chrupiącej skórce' },
];

const WYZWANIA_SPECJALNE = [
  'WYZWANIE SPECJALNE: Wymyśl kajzerkę, która nie powinna istnieć, i nadaj jej legendarną nazwę!',
  'WYZWANIE SPECJALNE: Zaprojektuj kanapkę dla kosmity. Piekarz Bułka czeka na raport.',
  'WYZWANIE SPECJALNE: Wymyśl hasło reklamowe dla Kajzerki Boga Piekarni!',
  'WYZWANIE SPECJALNE: Stwórz nazwę pieczywa tak epicką, że trafi do legend piekarni.',
  'WYZWANIE SPECJALNE: Wymyśl smak bułki, którego nawet sam BillyBulka by się nie spodziewał.',
];

function rollWyzwanie(rng = Math.random) {
  const roll = Math.floor(rng() * 1000);
  if (roll < 10) return { text: choose(WYZWANIA_SPECJALNE, rng), special: true, source: 'special' };
  if (roll < 510) return { text: choose(WYZWANIA_GOTOWE, rng), special: false, source: 'ready' };

  const item = choose(WYZWANIA_GENERATOR, rng);
  const template = Math.floor(rng() * 3);
  const endings = [
    'Masz na to 10 sekund!', 'Piekarz Bułka czeka na rezultat.', 'Liczy się kreatywność, nie perfekcja!',
    'Niech wyobraźnia wyrośnie jak ciasto drożdżowe.', 'Możesz zrobić to po swojemu.',
  ];
  const text = template === 0
    ? 'Wymyśl nazwę dla ' + item.item + '.'
    : template === 1
      ? 'Opisz w jednym zdaniu: ' + item.subject + '.'
      : 'Wymyśl hasło reklamowe dla ' + item.genitive + '.';
  return { text: text + ' ' + choose(endings, rng), special: false, source: 'generated' };
}

const PIEKARZE_ZWYKLI = [
  ['Pomocnik Piekarza', 'Dopiero zaczyna przygodę z pieczywem. Na razie odpowiada za pilnowanie mąki.'],
  ['Dostawca Mąki', 'Bez niego piekarnia nie ruszy. Podobno zna wszystkie młyny w okolicy.'],
  ['Naczelny Tester Kajzerek', 'Każda kajzerka musi przejść kontrolę jakości. Oczywiście przez degustację.'],
  ['Inspektor Okruszków', 'Pilnuje porządku na blacie. Niestety okruszki ciągle wygrywają.'],
  ['Mistrz Bułek Maślanych', 'Specjalista od puszystych wypieków. Masło to jego żywioł.'],
  ['Krojiciel Chleba', 'Potrafi pokroić bochenek na równe kromki. Przynajmniej tak twierdzi.'],
  ['Strażnik Piekarnika', 'Nie spuszcza pieca z oka. Przerwy na kawę są jednak podejrzanie długie.'],
  ['Mieszacz Ciasta', 'Łączy składniki z wielkim zaangażowaniem. Sprzątanie to osobna sprawa.'],
  ['Posypywacz Sezamu', 'Każda bułka zasługuje na sezam. Nawet jeśli połowa ląduje na podłodze.'],
  ['Specjalista od Drożdży', 'Wie, jak sprawić, żeby ciasto rosło. Z własną motywacją bywa różnie.'],
  ['Pakowacz Bagietek', 'Układa pieczywo z precyzją. Przynajmniej dopóki nikt nie patrzy.'],
  ['Kontroler Świeżości', 'Rozpoznaje wczorajszą bułkę z odległości trzech metrów.'],
  ['Mistrz Rogalików', 'Zawija ciasto szybciej niż ktokolwiek w okolicy. Podobno.'],
  ['Piekarniczy Sprzątacz', 'Dba o czystość piekarni. Mąka zawsze znajdzie sposób, żeby wrócić.'],
  ['Degustator Chleba', 'Zna smak każdego bochenka. Pracuje ciężko, szczególnie podczas przerw.'],
  ['Formiarz Bułek', 'Nadaje ciastu odpowiedni kształt. Czasami nawet zamierzony.'],
  ['Magazynier Ziarna', 'Pilnuje zapasów. Nikt nie wie, dlaczego ciągle brakuje słonecznika.'],
  ['Mistrz Tostów', 'Wie, kiedy tost jest idealnie chrupiący. Alarm przeciwpożarowy też go zna.'],
  ['Pomocnik od Zakwasu', 'Codziennie dogląda fermentacji. Zakwas ma podobno więcej charakteru niż on.'],
  ['Liczydło Okruszków', 'Żaden okruszek nie umknie jego uwadze. Matematyka jeszcze nigdy nie była tak piekarnicza.'],
  ['Mistrz Kruszonki', 'Wie, ile kruszonki potrzeba na drożdżówkę. Zawsze uważa, że można dodać więcej.'],
  ['Operator Wałka', 'Wałkuje ciasto z pełnym profesjonalizmem. Lepiej nie pytać, co jeszcze potrafi wałek.'],
  ['Tester Skórki', 'Ocenia chrupkość każdego wypieku. Czasem słychać go w całej piekarni.'],
  ['Zwyczajny Piekarz', 'Robi swoje i nie szuka rozgłosu. Bułki wychodzą, więc nikt nie zadaje pytań.'],
].map(([name, description]) => ({ name, description }));

const PIEKARZE_RZADKIE = [
  ['Doktor Bułkologii', 'Posiada doktorat z nauki o bułkach. Komisja nadal nie rozumie jego rozprawy.'],
  ['Minister Chrupkości', 'Odpowiada za poziom chrupania w całej piekarni. Nie uznaje miękkich tostów.'],
  ['Profesor Fermentacji', 'Rozumie zakwas lepiej niż własną rodzinę. Podobno prowadzi z nim regularne rozmowy.'],
  ['Pogromca Przypalonych Kajzerek', 'Żaden spalony wypiek go nie pokona. Ma na koncie trzy uratowane piekarniki.'],
  ['Mistrz Złotej Skórki', 'Jego chleby wyglądają jak z katalogu. Nawet piekarz z sąsiedztwa mu zazdrości.'],
  ['Alchemik Ciasta', 'Potrafi zamienić zwykłą mąkę w coś niezwykłego. Przepis pozostaje tajemnicą.'],
  ['Kierownik Piekarni', 'Zarządza wypiekami, personelem i chaosem. Najważniejszą decyzją dnia jest przerwa.'],
  ['Architekt Kanapek', 'Buduje kanapki, które przeczą prawom grawitacji. Konstrukcje bywają niestabilne.'],
  ['Władca Drożdży', 'Ciasto rośnie na jego rozkaz. Przynajmniej dopóki temperatura jest odpowiednia.'],
  ['Naczelny Piekarnikowy', 'Zna każdy przycisk w piecu. Instrukcję obsługi przeczytał tylko raz.'],
].map(([name, description]) => ({ name, description }));

const PIEKARZE_LEGENDARNE = [
  ['Legenda Piekarni', 'O jego wypiekach krążą opowieści. Nawet zakwas fermentuje szybciej na sam jego widok.'],
  ['Najwyższy Piekarz', 'Osiągnął szczyt piekarniczej kariery. Bułki same ustawiają się w kolejce.'],
  ['Władca Piekarnika', 'Temperatura słucha jego poleceń. Przypalone wypieki znikają z szacunku.'],
  ['Bóstwo Zakwasu', 'Jego zakwas jest starszy niż niejedna piekarnia. Nikt nie odważy się zapytać o jego wiek.'],
  ['Mityczny Kajzerkowy', 'Zna sekret idealnej kajzerki. Podobno przepis zapisano na okruszku.'],
  ['Cesarz Wszystkich Bułek', 'Wszystkie wypieki uznają jego władzę. Nawet bagietki salutują, gdy przechodzi.'],
].map(([name, description]) => ({ name, description }));

function rollPiekarz(rng = Math.random) {
  const title = chooseByPercent(rng, PIEKARZE_ZWYKLI, PIEKARZE_RZADKIE, PIEKARZE_LEGENDARNE);
  return {
    ...title,
    rarity: PIEKARZE_LEGENDARNE.includes(title) ? 'legendarny' : PIEKARZE_RZADKIE.includes(title) ? 'rzadki' : 'zwykły',
  };
}

function getPiekarzForStream(targetKey, streamId, options = {}) {
  const rng = options.rng || Math.random;
  const cache = options.cache || piekarzCache;
  const persist = options.persist !== false;
  const stableStreamId = String(streamId || ('offline-' + new Date().toISOString().slice(0, 10)));
  const key = stableStreamId + ':' + String(targetKey || '').toLowerCase();
  if (cache[key]) return { title: cache[key], alreadyAssigned: true };

  for (const oldKey of Object.keys(cache)) {
    if (!oldKey.startsWith(stableStreamId + ':')) delete cache[oldKey];
  }
  const title = rollPiekarz(rng);
  cache[key] = title;
  if (persist) saveCache(PIEKARZ_CACHE_FILE, cache);
  return { title, alreadyAssigned: false };
}

// Kajzerki BillyBulki: 70 zwykłych, 20 specjalnych, 10 tajnych.
const KAJZERKI_ZWYKLE = [
  ['Kajzerka klasyczna', 'Chrupiąca skórka, miękki środek.'],
  ['Kajzerka sezamowa', 'Posypana sezamem, żeby wyglądała bardziej profesjonalnie.'],
  ['Kajzerka makowa', 'Po zjedzeniu trzeba sprawdzić zęby.'],
  ['Kajzerka słonecznikowa', 'Z ziarnami słonecznika.'],
  ['Kajzerka dyniowa', 'Z pestkami dyni.'],
  ['Kajzerka lniana', 'Z siemieniem lnianym.'],
  ['Kajzerka wieloziarnista', 'Mieszanka różnych ziaren.'],
  ['Kajzerka pełnoziarnista', 'Ciemniejsza i bardziej konkretna.'],
  ['Kajzerka maślana', 'Delikatna i maślana.'],
  ['Kajzerka mleczna', 'Miękka i puszysta.'],
  ['Kajzerka razowa', 'Solidny wypiek z mąki razowej.'],
  ['Kajzerka z otrębami', 'Dla miłośników chrupiących dodatków.'],
  ['Kajzerka z czarnuszką', 'Charakterystyczny aromat.'],
  ['Kajzerka z kminkiem', 'Tradycyjny smak.'],
  ['Kajzerka z serem na wierzchu', 'Zapieczona posypka serowa.'],
  ['Kajzerka czosnkowa', 'Aromatyczna i wyrazista.'],
  ['Kajzerka ziołowa', 'Z mieszanką ziół.'],
  ['Kajzerka cebulowa', 'Z suszoną cebulką.'],
  ['Kajzerka paprykowa', 'Z nutą papryki.'],
  ['Kajzerka przypieczona', 'Mocniej wypieczona skórka.'],
  ['Kajzerka z szynką', 'Klasyczna kanapka.'],
  ['Kajzerka z serem żółtym', 'Prosta i konkretna.'],
  ['Kajzerka z szynką i serem', 'Duet idealny.'],
  ['Kajzerka z bekonem', 'Chrupiący bekon w środku.'],
  ['Kajzerka z kurczakiem', 'Kawałki kurczaka i pieczywo.'],
  ['Kajzerka z indykiem', 'Delikatne mięso z indyka.'],
  ['Kajzerka z salami', 'Wyrazisty smak.'],
  ['Kajzerka z kabanosem', 'Konkretna przekąska.'],
  ['Kajzerka z kiełbasą', 'Swojska wersja kanapki.'],
  ['Kajzerka z pasztetem', 'Klasyka polskich kanapek.'],
  ['Kajzerka z parówką', 'Prawie hot dog.'],
  ['Kajzerka z serem cheddar', 'Wyrazisty ser.'],
  ['Kajzerka z mozzarellą', 'Delikatna i ciągnąca.'],
  ['Kajzerka z serem pleśniowym', 'Dla odważnych smakoszy.'],
  ['Kajzerka z szynką i cheddarem', 'Podwójnie serowa przyjemność.'],
  ['Kajzerka z bekonem i serem', 'Solidna porcja kalorii.'],
  ['Kajzerka z kurczakiem i serem', 'Sprawdzony duet.'],
  ['Kajzerka z salami i mozzarellą', 'Włoskie inspiracje.'],
  ['Kajzerka z szynką i jajkiem', 'Śniadaniowy zestaw.'],
  ['Kajzerka z jajkiem i serem', 'Prosta, sycąca kombinacja.'],
  ['Kajzerka z sałatą', 'Lekka i chrupiąca.'],
  ['Kajzerka z pomidorem', 'Soczysty dodatek.'],
  ['Kajzerka z ogórkiem', 'Świeży akcent.'],
  ['Kajzerka z kiszonym ogórkiem', 'Kwaśna i konkretna.'],
  ['Kajzerka z cebulą', 'Dla fanów wyrazistych smaków.'],
  ['Kajzerka z papryką', 'Kolorowa kanapka.'],
  ['Kajzerka z rukolą', 'Lekko pikantna nuta.'],
  ['Kajzerka z oliwkami', 'Śródziemnomorski klimat.'],
  ['Kajzerka z kukurydzą', 'Słodkawy dodatek.'],
  ['Kajzerka z pieczarkami', 'Pieczarkowa klasyka.'],
  ['Kajzerka z sosem czosnkowym', 'Czosnek rządzi.'],
  ['Kajzerka z ketchupem', 'Prosta i sprawdzona.'],
  ['Kajzerka z majonezem', 'Kremowa klasyka.'],
  ['Kajzerka z musztardą', 'Odrobina ostrości.'],
  ['Kajzerka z sosem barbecue', 'Dymny aromat.'],
  ['Kajzerka z ostrym sosem', 'Dla fanów pikantnych smaków.'],
  ['Kajzerka z szynką, serem i pomidorem', 'Pełna kanapka.'],
  ['Kajzerka z bekonem i sałatą', 'Chrupiąca kombinacja.'],
  ['Kajzerka z kurczakiem i sosem czosnkowym', 'Klasyka fast foodu.'],
  ['Kajzerka z serem, ogórkiem i ketchupem', 'Prosta kompozycja.'],
  ['Kajzerka z masłem', 'Minimalistyczna klasyka.'],
  ['Kajzerka z masłem i miodem', 'Słodkie śniadanie.'],
  ['Kajzerka z dżemem truskawkowym', 'Owocowa wersja.'],
  ['Kajzerka z dżemem malinowym', 'Słodko i lekko kwaśno.'],
  ['Kajzerka z kremem czekoladowym', 'Deser w pieczywie.'],
  ['Kajzerka z masłem orzechowym', 'Orzechowa przekąska.'],
  ['Kajzerka z bananem', 'Owocowa kombinacja.'],
  ['Kajzerka z twarożkiem', 'Delikatna i kremowa.'],
  ['Kajzerka z twarożkiem i szczypiorkiem', 'Śniadaniowy klasyk.'],
  ['Kajzerka z jajecznicą', 'Porządne śniadanie piekarza.'],
].map(([name, description]) => ({ name, description }));

const KAJZERKI_SPECJALNE = [
  ['Kajzerka XXL', 'Tyle dodatków, że ledwo można ją zamknąć.'],
  ['Kajzerka Potrójnie Serowa', 'Trzy rodzaje sera w jednym wypieku.'],
  ['Kajzerka Mięsna Bomba', 'Szynka, bekon, salami i kiełbasa.'],
  ['Kajzerka Czosnkowy Potwór', 'Czosnek, sos czosnkowy i jeszcze więcej czosnku.'],
  ['Kajzerka Ostra Jak Piekło', 'Ostry sos i papryczki.'],
  ['Kajzerka Śniadaniowego Mistrza', 'Jajko, bekon, ser i sos.'],
  ['Kajzerka Włoska', 'Mozzarella, pomidor i bazylia.'],
  ['Kajzerka Grillowa', 'Kurczak, ser i sos barbecue.'],
  ['Kajzerka Leśna', 'Pieczarki, cebula i ser.'],
  ['Kajzerka Ogrodnika', 'Dużo warzyw i sos ziołowy.'],
  ['Kajzerka Słodko-Słona', 'Bekon, ser i odrobina miodu.'],
  ['Kajzerka Potrójnie Chrupiąca', 'Mocno wypieczona, z bekonem i prażoną cebulką.'],
  ['Kajzerka Piekarza', 'Szynka, ser, sałata i sekretny sos.'],
  ['Kajzerka Królewska', 'Podwójna porcja mięsa i sera.'],
  ['Kajzerka Tostowa', 'Kajzerka z zapieczonym serem i szynką.'],
  ['Kajzerka Gigant', 'Wypiek wielkości małego bochenka.'],
  ['Kajzerka Mistrza Zakwasu', 'Na zakwasie, z chrupiącą skórką.'],
  ['Kajzerka Turbo', 'Znika szybciej, niż zdążysz ją zamówić.'],
  ['Kajzerka Spóźnionego Piekarza', 'Trochę za długo czekała na wyjęcie z pieca.'],
  ['Kajzerka Szefa Kuchni', 'Losowe mięso, ser, warzywa i sos.'],
].map(([name, description]) => ({ name, description }));

const KAJZERKI_TAJNE = [
  ['Kajzerka Legendarna', 'Wypiek, o którym opowiadają pokolenia piekarzy.'],
  ['Kajzerka BillyBulki', 'Firmowa kajzerka właściciela piekarni. Przepis jest pilnie strzeżony.'],
  ['Kajzerka Złota', 'Pokryta legendarną, złocistą skórką.'],
  ['Kajzerka Nieskończonego Sera', 'Ser ciągnie się bez końca.'],
  ['Kajzerka Zakazanego Przepisu', 'Nikt nie wie, co znajduje się w środku.'],
  ['Kajzerka Kosmiczna', 'Wypiek podobno dostarczony prosto z Marsa.'],
  ['Kajzerka Nieśmiertelna', 'Podobno nigdy nie czerstwieje.'],
  ['Kajzerka Piekielna', 'Tak ostra, że piekarnik sam się otwiera.'],
  ['Kajzerka Absolutna', 'Idealne pieczywo, którego nie da się ulepszyć.'],
  ['Kajzerka Boga Piekarni', 'Najrzadszy wypiek w całej kolekcji.'],
].map(([name, description]) => ({ name, description }));

function rollBillyBulkaVariant(rng = Math.random) {
  const variant = chooseByPercent(rng, KAJZERKI_ZWYKLE, KAJZERKI_SPECJALNE, KAJZERKI_TAJNE);
  return {
    ...variant,
    rarity: KAJZERKI_TAJNE.includes(variant) ? 'tajna' : KAJZERKI_SPECJALNE.includes(variant) ? 'specjalna' : 'zwykła',
  };
}

function getBillyBulkaForDay(dateKey, options = {}) {
  const rng = options.rng || Math.random;
  const cache = options.cache || kajzerkaCache;
  const persist = options.persist !== false;
  const key = String(dateKey);
  if (cache[key]) return { variant: cache[key], alreadyAssigned: true };
  for (const oldKey of Object.keys(cache)) {
    if (oldKey !== key) delete cache[oldKey];
  }
  const variant = rollBillyBulkaVariant(rng);
  cache[key] = variant;
  if (persist) saveCache(KAJZERKA_CACHE_FILE, cache);
  return { variant, alreadyAssigned: false };
}

function handleCommand({ message, nick, login, streamId }, options = {}) {
  const rng = options.rng || Math.random;
  if (!message || !nick) return null;
  const text = String(message).trim();
  const match = text.match(/^!(zakwas|wyzwanie|piekarz|swiezy|smak|okruszek|przypalony)(?:\s+@?([a-zA-Z0-9_]+))?$/i);
  if (match) {
    const command = match[1].toLowerCase();
    const hasTarget = Boolean(match[2]);
    const target = hasTarget ? match[2] : nick;
    const targetKey = (hasTarget ? match[2] : (login || nick)).toLowerCase();

    if (command === 'zakwas') {
      const result = rollZakwas(rng);
      return '🍞 @' + target + ' ma dziś ' + result.value + '% zakwasu — ' + result.comment;
    }
    if (command === 'swiezy') {
      const result = rollFromBands(SWIEZOSC_KOMENTARZE, rng);
      return '🥐 @' + target + ' ma dziś ' + result.value + '% świeżości — ' + result.comment;
    }
    if (command === 'przypalony') {
      const result = rollFromBands(PRZYPALENIE_KOMENTARZE, rng);
      return '🔥 @' + target + ' ma dziś ' + result.value + '% przypalenia — ' + result.comment;
    }
    if (command === 'smak') {
      return '🥐 @' + target + ' ma dziś smak na ' + choose(SMAKI, rng) + '. Piekarz zatwierdza ten wybór!';
    }
    if (command === 'okruszek') {
      return '🍞 @' + target + ', znaleziono u Ciebie ' + randomInt(rng, 1, 100) + ' okruszków. Schowaj je dobrze, bo wróble już patrzą!';
    }
    if (command === 'wyzwanie') {
      const result = rollWyzwanie(rng);
      return '🎯 Wyzwanie dla @' + target + ': ' + result.text;
    }
    if (command === 'piekarz') {
      const result = getPiekarzForStream(targetKey, streamId, options);
      const title = result.title;
      if (result.alreadyAssigned) {
        return '🍞 @' + target + ', masz już tytuł na ten stream: ' + title.name + '! ' + title.description;
      }
      return '🍞 @' + target + ' zostaje: ' + title.name + '! ' + title.description;
    }
  }

  const bulkaMatch = text.match(/^!(?:bułka|bulka)(?:\s+@?([a-zA-Z0-9_]+))?$/i);
  if (bulkaMatch) {
    const senderLogin = String(login || nick).toLowerCase();
    const targetLogin = bulkaMatch[1] ? bulkaMatch[1].toLowerCase() : null;
    const isBillyTarget = targetLogin === 'billybulka';
    const isBillySender = !targetLogin && senderLogin === 'billybulka';
    if (isBillyTarget || isBillySender) {
      const dateKey = new Date().toISOString().slice(0, 10);
      const result = getBillyBulkaForDay(dateKey, options);
      return '🥖 @BillyBulka otrzymuje ' + result.variant.name + '! ' + result.variant.description
        + (result.variant.rarity === 'tajna' ? ' ✨ TAJNY WYPIEK!' : '');
    }
  }

  return null;
}

module.exports = {
  ZAKWASZE_KOMENTARZE,
  SWIEZOSC_KOMENTARZE,
  PRZYPALENIE_KOMENTARZE,
  SMAKI,
  WYZWANIA_GOTOWE,
  WYZWANIA_GENERATOR,
  WYZWANIA_SPECJALNE,
  PIEKARZE_ZWYKLI,
  PIEKARZE_RZADKIE,
  PIEKARZE_LEGENDARNE,
  KAJZERKI_ZWYKLE,
  KAJZERKI_SPECJALNE,
  KAJZERKI_TAJNE,
  rollZakwas,
  rollFromBands,
  rollWyzwanie,
  rollPiekarz,
  getPiekarzForStream,
  rollBillyBulkaVariant,
  getBillyBulkaForDay,
  handleCommand,
};
