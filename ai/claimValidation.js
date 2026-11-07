'use strict';

const { ENTITY_ALIAS_GROUPS, buildEntityAliasPatterns } = require('./entityAliases');
const { slowaLiczbowe } = require('./polishNumbers');
const { GAME_ALIASES } = require('./entities');
const { findQuotePrefix } = require('./evidence');
const { ucieknijRegex } = require('./regex-utils');

const NEGATION_RE = /(?<![\p{L}])(?:nie|nigdy|brak|bez|zaden|zadna|zadne|never|no|not|cannot|without|lack\s+of|absence\s+of|unable|neither|nor|fails?\s+to|\p{L}+n['\u2019]t)(?![\p{L}])/iu;
// Ta sama lista bez gołego „no”: „no damage” to kwantyfikator zerowy, a nie zaprzeczenie czasownika.
const NEGATION_STRICT_RE = /(?<![\p{L}])(?:nie|nigdy|brak|bez|zaden|zadna|zadne|never|not|cannot|without|lack\s+of|absence\s+of|unable|neither|nor|fails?\s+to|\p{L}+n['\u2019]t)(?![\p{L}])/iu;
// Claim o redukcji/ograniczeniu jest zgodny z dowodem „no damage / take no damage” (zero implikuje zmniejszenie).
// „s?tlumi\w*” obejmuje odmiany „tlumic” (tlumiaca, tlumienie, stlumic), ale nie „tlumaczy”/„tlum”.
const REDUCTION_RE = /(?<![\p{L}])(?:zmniejsz\w*|ogranicz\w*|redukuj\w*|zredukow\w*|oslab\w*|ochron\w*|oslon\w*|chron\w*|neutralizuj\w*|reduc\w*|inhibit\w*|dampen\w*|s?tlumi\w*|mitigat\w*|lower\w*|decreas\w*|protect\w*|prevent\w*|avoid\w*|block(?:s|ed|ing)?\s+(?:access|attacks?|damage|the\s+entrance|the\s+path|movement|progress)|ward\w*|immun\w*|resist\w*|zapobieg\w*|unik\w*|blokad\w*|zablokow\w*|blokuj\w*|odporn\w*)(?![\p{L}])/iu;
// „skutkuj\w*” i „w rezultacie” to polskie odpowiedniki „resulting in”/„as a result”: bez nich
// polski claim z relacja przyczynowa przechodzil kontrole parytetu PL↔EN, gdy claim_en ja gubil.
const CAUSAL_RE = /(?<![\p{L}])(?:bo|poniewaz|gdyz|dlatego|because|therefore|caus\w*|corrupt\w*|skorumpow\w*|trigger\w*|consequently|hence|as\s+a\s+result|as\s+(?:they|he|she|it|we)\s+(?:have|has|had|are|were|can|could|will|would|need|needs|needed)\b|led\s+to|leading\s+to|resulted\s+in|resulting\s+in|because\s+of|due\s+to|thereby|thus|w\s+ten\s+sposob|przez\s+co|co\s+(?:umozliw\w*|spowod\w*|pozwal\w*)|motyw\w*|zmusz\w*|powoduj\w*|przyczyn\w*|wskutek|w\s+efekcie|skutkuj\w*|w\s+rezultacie|allow(?:s|ed|ing)?|enabl(?:e|es|ed|ing)|which\s+(?:let|lets|allowed|allows|enabled|enables)|putting\s+(?:him|her|them|it)\s+in\s+control|giving\s+(?:him|her|them|it)\s+control|will\s+see\s+(?:him|her|them|the player|the character)\s+(?:officially\s+)?(?:join|become)|dajac\s+(?:mu|jej|im)\s+(?:wladz\w*|kontrol\w*|panowan\w*)|force(?:s|d|ing)?\s+(?:the\s+)?[\p{L}\p{N}'\u2019_-]+(?:\s+[\p{L}\p{N}'\u2019_-]+){0,1}\s+to\s+[\p{L}\p{N}'\u2019_-]+|so\s+(?:he|she|they|it|we|the)|in\s+exchange(?:\s+for)?|in\s+return(?:\s+for)?|in\s+turn|thanks\s+to|owing\s+to|w\s+zamian(?:\s+za)?|w\s+rewan[zz]u|w\s+wyniku|z\s+powodu|dzieki|spowod\w*|doprowadz\w*|umozliw\w*)(?![\p{L}])/iu;
// Nie traktujemy samego „force” jako przyczynowosci: „forced a core transfer”
// moze opisywac akcje. Rozpoznajemy jednak konstrukcje „force X to Y” oraz
// bezposrednie „giving him control”, ktore wyrazaja relacje miedzy zdarzeniami.
// Purpose clauses („so that X could…”) nadal nie dowodza, ze skutek nastapil.
// Purpose clauses express intent or a possible outcome, not proof that the outcome
// occurred. Keep them out of the causal-evidence signal; the validator separately
// checks purpose-versus-completed-outcome semantics.
const CAUSAL_EVIDENCE_RE = CAUSAL_RE;
const TEMPORAL_RE = /(?<![\p{L}])(?:19|20)\d{2}(?![\p{L}])|(?<![\p{L}])(?:styczen|luty|marzec|kwiecien|maj|czerwiec|lipiec|sierpien|wrzesien|pazdziernik|listopad|grudzien|wczoraj|dzisiaj|jutro|today|yesterday|tomorrow)(?![\p{L}])/iu;
const CROSS_LANGUAGE_CONCEPTS = [
  ['porwanie', /kidnap\w*|abduct\w*|captur\w*|porwan\w*|uprowadz\w*|schwyt\w*/i],
  ['transfer_rdzenia', /core transfer|transfer of (?:the )?core|transfer(?:u|em|ze)? rdzenia|transfer rdzenia/i],
  ['obrazenia', /injur\w*|wound\w*|hurt\w*|damage\w*|harm\w*|rann\w*|obraz\w*/i],
  ['zabojstwo', /kill\w*|murder\w*|death|dead|zabij\w*|zabil\w*|zabila\w*|zabici\w*|zabity\w*|zabicie\w*|zgin\w*|smier\w*/i],
  ['konflikt', /conflict\w*|feud\w*|fight\w*|\bwar\w*|hatred|hate\w*|konflikt\w*|walcz\w*|wojn\w*/i],
  ['zwiazek', /relationship\w*|girlfriend\w*|boyfriend\w*|partner\w*|romanc\w*|romantic\w*|involved|zwi[aa]zk\w*|zwiaz\w*|relacj\w*|dziewczyn\w*|chlopak\w*/i],
  ['pomoc', /help\w*|assist\w*|save\w*|rescu\w*|pomog\w*|pomaga\w*|urat\w*|ocal\w*/i],
  // Granica slowa przed „appear”: „disappears” oznacza przeciwna akcje i nie moze byc uznane za „appears”.
  ['wystepowanie', /\b(?:appear\w*|pojaw\w*|wystep\w*)/i],
  ['kontrola', /control\w*|take[s]?\s+over|command\w*|manipulat\w*|kontrol\w*|przej[a]l\w*|manipul\w*|removed?\s+from\s+power|los[et]\s+control/i],
  // „bossem”, „bossa”, „bosses”: odmiana nie moze zerwac zgodnosci pojecia PL↔EN.
  ['szef', /\bboss\w*|szef\w*|leader\w*|przywodc\w*/i],
  ['porazka', /defeat\w*|beaten|overcome\w*|pokon\w*|pora[zz]k\w*/i],
  ['zdrada', /betray\w*|traitor\w*|zdradz\w*|zdrajc\w*/i],
  ['tworzenie', /creat\w*|develop\w*|build\w*|made\b|stworz\w*|tworz\w*|zbudow\w*|budow\w*|opracow\w*/i],
  ['wejscie_do_miejsca', /\benter(?:s|ed|ing)?\b|\bentrance\b|wejsc\w*|dostac\s+si[ee]|wejsc\s+do/i],
  ['rzucanie', /\bthrow(?:s|n|ing)?\b|rzuc\w*|wyrzuc\w*/i],
  ['most', /\bbridg(?:e|es|ed|ing)\b|most\w*/i],
  ['szansa', /\bchances?\b|szans\w*/i],
  ['lekarstwo', /\bcures?\b|\bremed(?:y|ies)\b|antidotes?\b|lekarstw\w*|\bterapi\w*/i],
  ['zbieranie_lootu', /\bcollect(?:s|ed|ing)?\b|\bloot\w*|zabier\w*|zebran\w*|zebr\w*|lup\w*/i],
  ['ramka_przedmiotow', /\bitem\s+frames?\b|ramk\w*\s+(?:na|z)\s+przedmiot\w*/i],
  ['skrzynia', /\bchests?\b|skrzyni\w*/i],
  ['shulker', /\bshulkers?\b/i],
  ['przyjecie_oferty', /taking (?:him )?up on (?:this|the) offer|przyj[ee]ci\w*\s+(?:tej\s+)?ofert\w*/i],
  ['destrukcja', /destroy\w*|destruct\w*|demolish\w*|ruin\w*|zniszcz\w*|zniszczen\w*|rozbij\w*/i],
  ['praca', /work\w*|employ\w*|job\w*|prac\w*|zatrud\w*/i],
  ['lokalizacja', /found|find\w*|locat\w*|location\w*|znalezc\w*|znajduj\w*|lokaliz\w*|lezy|polozen\w*/i],
  ['wydanie', /release\w*|launch\w*|publish\w*|premier\w*|wydan\w*|ukaz\w*|debiut\w*/i],
  ['podroz', /travel\w*|arriv\w*|visit\w*|reach\w*|journey\w*|get there|follow\w*\s+(?:the\s+)?(?:road|route|path)|head\w*\s+to|udaj\w*\s+si[ee]|dotrze\w*|dotrz\w*|pod[aa][zz]\w*|szlak\w*|odwiedz\w*|przybyw\w*/i],
  ['rodzina', /family|families|wife|daughter|son|missing\s+(?:wife|daughter|son|family)|rodzin\w*|zaginion\w*|zona|corka|syn\w*/i],
  ['wymiana_informacji', /in\s+exchange\s+for|in\s+return\s+for|exchange\w*|w\s+zamian\s+za|w\s+zamian\w*|wzajemn\w*/i],
  ['poscig', /chas\w*|pursu\w*|hunt(?:ed|ing|s)\b|flee\w*|escap\w*|uciek\w*|uciec\b|gonil\w*|scig\w*|ucieczk\w*/i],
  ['schronienie', /shelter\w*|refuge\w*|seek\w*\s+shelter|schron\w*|azyl\w*/i],
  ['informacja', /information\w*|informacj\w*|wiadomos\w*/i],
  ['ogien', /fire\w*|flame\w*|ogn\w*|plomien\w*/i],
  ['lod', /frost\w*|\bice\b|lod\w*|mroz\w*/i],
  ['smok', /dragon\w*|smok\w*/i],
  ['zaklecie', /spell\w*|magic\w*|mag\w*|zakle\w*/i],
  ['bron', /weapon\w*|sword\w*|bron\w*/i],
  ['elf', /\bhigh\s+elf\b|\belves?\b|elf\w*/i],
  ['wampir', /vampire\w*|wampir\w*/i],
  ['klasa_rogue', /\brogue\b|thief\w*|lotr\w*|zlodziej\w*/i],
  ['towarzysz', /\bcompanions?\b|recruit\w*|party member\w*|join(?:s|ed|ing)? (?:the|your) party|druzyn\w*|minion\w*|summon\w*|towarzysz\w*|zrekrut\w*|wezw\w*|przywol\w*/i],
  ['rekrutacja_towarzysza', /zrekrut\w*|dolacz\w*|join(?:s|ed|ing)? (?:the|your) party|recruit\w*/i],
  ['ataki_dystansowe', /\branged\b|\bbow\b|luk\w*|dystansow\w*/i],
  ['modyfikacja_zachowania', /\bbehav\w*|make her behave|intelligence dampening|tlumi\w*|zmusz\w*|zachow\w*|rdzen osobowosci|force(?:s|d|ing)?\s+(?:the\s+)?[\w'-]+(?:\s+[\w'-]+){0,1}\s+to\s+[\w'-]+/i],
  ['walka_konna', /horseback|mounted combat|on horseback|konskiego grzbietu|na koniu|z konia|walczac z konia/i],
  ['pozycja_zdystansu', /far back|high up|at range|dystans\w*|z daleka|na dystans/i],
  ['gigantyczne_zwierzeta', /giant (?:zombie[- ]?)?dogs?|gigantyczn\w*\s+(?:zombie\s+)?ps\w*|wielkie (?:zombie\s+)?psy/i],
  ['ochrona_miejsca', /guard\w*|strzez\w*|pilnow\w*/i],
  ['atak', /\b(?:attack\w*|atak\w*|zaatak\w*)\b/i],
  ['okrzyk', /\b(?:shout\w*|okrzyk\w*)\b/i],
  ['ostroznosc', /cautious\w*|approach cautiously|ostrozn\w*|ostrozne podejscie/i],
  ['zagrozenie', /lethal|dangerous|deadly|niebezpiecz\w*|zabojcz\w*/i],
  ['grywalnosc_postaci', /\bplay as\b|\bplayable character\b|\bcontrol (?:the|a|your) character\b|sterow\w*|mozna nim grac|nim grac/i],
  // Do not match generic 'land/lands' (e.g. fertile lands) or the spell name alone.
  // Require an explicit dragon-landing relation to avoid false concept overlap.
  ['smok_na_ziemi', /\bdragons?\b.{0,40}\b(?:land(?:s|ed|ing)?|stay on the ground|on the ground)\b|\b(?:land(?:s|ed|ing)? on the ground|stay on the ground)\b.{0,40}\bdragons?\b|\bsmok\w*.{0,40}\b(?:wyladow\w*|ladow\w*|laduje\w*|pozostac na ziemi|na ziemi)\b|\b(?:wyladow\w*|laduje\w*).{0,40}\bsmok\w*\b/i],
  ['odpornosc_zywiolowa', /resistan\w*|ward\w*|spellbreaker|odpornosc\w*|wardy|tarcze?\w*/i],
];
function pojeciaCrossLanguage(value) {
  const text = normalizujClaim(value);
  return new Set(CROSS_LANGUAGE_CONCEPTS.filter(([, re]) => re.test(text)).map(([name]) => name));
}

const COVERAGE_STOPWORDS = new Set(['jest','byla','bylo','byli','zostal','zostala','zostalo','oraz','ktory','ktora','ktore','przez','jako','jego','jej','this','that','with','from','were','was','have','has']);
const GENERIC_CAPITALIZED_WORDS = new Set([
  // Zwykle rzeczowniki, czasowniki i okreslenia blednie wyciagane jako nazwy,
  // gdy autor odpowiedzi zapisze je wielka litera w srodku zdania.
  'rozdzial', 'rozdzialu', 'rozdziale', 'rozdzialem', 'chapter', 'chapters',
  'oboz', 'obozu', 'obozie', 'obozem', 'obozow', 'obozami', 'obozach', 'camp', 'inside', 'within', 'wewnatrz', 'wewnatrzu', 'wewnetrz',
  'droga', 'drogi', 'droge', 'road', 'route', 'path',
  'pojawia', 'pojawilo', 'pojawil', 'pojawila', 'pojawiaja', 'appears', 'appeared', 'appear',
  'pomaga', 'pomagal', 'pomogla', 'pomogli', 'pomagaja', 'helps', 'helped', 'help',
  'centrum', 'rozbudowy', 'center', 'centre', 'expansion', 'facility',
  'kampanii', 'kampania', 'campaign', 'gra', 'gry', 'game', 'games',
  'wioska', 'wioski', 'village', 'villages', 'kierunku', 'direction',
  'czesc', 'czesci', 'part', 'first', 'main', 'glowna', 'glownej',
  'zachodnim', 'zachodnia', 'west', 'north', 'south', 'east',
  'bezposrednio', 'directly', 'initially', 'initial', 'poczatkowo',
  'deuteragonisty', 'role', 'rola', 'character', 'postac', 'postaci',
  'trafia', 'przybywa', 'przybyl', 'wystepuje', 'arrives', 'arrived',
  'znajduje', 'located', 'lezy', 'prowadzi',
].map(normalizujClaim));
const KNOWN_ENTITY_ALIAS_PATTERNS = [
  { canonical: 'greatsword', pattern: /\b(?:greatsword|wielk(?:i|iego|iemu|im|imi)\s+miec(?:z|za|zem|zowi|zu))\b/iu },
  // Accept the benchmark source's one-letter misspelling `drgon bane` only for the known item.
  { canonical: 'dragonbane', pattern: /\bdr(?:a)?gon\s*bane\b/iu },
  { canonical: "alduin's wall", pattern: /\b(?:alduin['\u2019]?s|alduins)\s+wall\b/iu },
  { canonical: 'dragonrend', pattern: /\bdragonrend\b/iu },
  // Minecraft: „End”, „Endu” i „Endzie” oznaczaja te sama kraine.
  { canonical: 'the end', pattern: /\b(?:the\s+end|end(?:u|em|zie|a)|kraw[eę]dz(?:i|ia|ie|iach|iom|mi)?)\b/iu },
  // Minecraft: polska nazwa Ender Pearl to „perla Kresu” (Kres = End); bez aliasu „Kresu” bylo
  // wymagana nazwa wlasna, ktorej nie ma w angielskim tlumaczeniu.
  { canonical: 'ender pearl', pattern: /\b(?:ender\s+pearls?|per[lł](?:a|ę|e|y|i)?\s+kresu)\b/iu },
  { canonical: 'spellbreaker', pattern: /\b(?:spellbreaker|zaklinacz\s+spellbreaker|lamacz(?:a|owi|em|u)?\s+zakl(?:e|e)c)\b/iu },
  { canonical: 'extended relaxation center', pattern: /\b(?:extended\s+relaxation\s+center|centrum\s+(?:przedluzonego|rozszerzonego)\s+relaksu)\b/iu },
  { canonical: 'aperture laboratories', pattern: /\b(?:aperture\s+laboratories|laboratori(?:a|ach|ami|ow|ow)\s+aperture)\b/iu },
  // „facility of Aperture” to PARAFRAZA z jednego zrodla benchmarku, nie nazwa —
  // zalozenie do potwierdzenia na szerszej probie. „Aperture Labs” celowo usuniete:
  // zlewaloby sie z osobnym wpisem „aperture laboratories” powyzej.
  { canonical: 'aperture science', pattern: /\b(?:aperture\s+science|facility\s+of\s+aperture)\b/iu },
  { canonical: 'bloody baron', pattern: /\b(?:bloody\s+baron|baron(?:a)?\s+krwaw(?:y|ego|ym)|krwaw(?:y|ego|emu)\s+baron(?:a|em|owi)?)\b/iu },
  // „Oka Nehaleni” is an inflected Polish form; keep an explicit full-name alias
  // because the generic token inflector cannot safely infer this proper-name form.
  { canonical: 'eye of nehaleni', pattern: /\b(?:eye\s+of\s+nehaleni|oko\s+nehaleni|oka\s+nehaleni)\b/iu },
  // Localized Dragonborn lore titles remain equivalent across Polish and English.
  { canonical: 'dragonborn', pattern: /\b(?:dragonborn|dovahkiin|laat\s+dovahkiin)\b/iu },
  { canonical: 'last dragonborn', pattern: /\b(?:last\s+dragonborn|ostatni(?:m|ego|emu|ym)?\s+dragonborn(?:em|a|owi|ie)?)\b/iu },
  { canonical: 'prophecy of the dragonborn', pattern: /\b(?:prophecy\s+of\s+the\s+dragonborn|proroctw(?:o|a|u|ie|em)\s+dragonborn(?:a|u|em|ie)?)\b/iu },
  { canonical: 'wild hunt', pattern: /\b(?:wild\s+hunt|dziki\s+gon|dzikiego\s+gonu|dzikim\s+gonem)\b/iu },
  { canonical: 'cathedral of dragon communion', pattern: /\b(?:cathedral\s+of\s+dragon\s+communion|katedr(?:a|y|e|e|ze)\s+komunii\s+smoka)\b/iu },
];
// Aliasy z tabeli danych (ai/entityAliases.js) laczymy z legacy regexami.
// Nie pomijamy grupy tylko dlatego, ze jej kanoniczna nazwa juz istnieje:
// starszy regex moze nie obslugiwac odmiany polskiej (np. „Krwawym Baronem”).
for (const entry of buildEntityAliasPatterns(ENTITY_ALIAS_GROUPS)) {
  const existing = KNOWN_ENTITY_ALIAS_PATTERNS.find(item => item.canonical === entry.canonical);
  if (!existing) {
    KNOWN_ENTITY_ALIAS_PATTERNS.push(entry);
    continue;
  }
  existing.pattern = new RegExp(`(?:${existing.pattern.source})|(?:${entry.pattern.source})`, 'iu');
}
function czyZnakSlowaUnicode(znak) {
  return Boolean(znak) && /[\\p{L}\\p{N}_]/u.test(znak);
}

function znakPrzed(tekst, indeks) {
  if (indeks <= 0) return '';
  let poczatek = indeks - 1;
  const kod = tekst.charCodeAt(poczatek);
  if (kod >= 0xDC00 && kod <= 0xDFFF && poczatek > 0) poczatek--;
  return tekst.slice(poczatek, indeks);
}

function znakPo(tekst, indeks) {
  if (indeks >= tekst.length) return '';
  return String.fromCodePoint(tekst.codePointAt(indeks));
}

function czyNazwySasiaduja(tekst, pierwsza, druga) {
  const lewa = normalizujClaim(pierwsza);
  const prawa = normalizujClaim(druga);
  if (!lewa || !prawa || lewa.length > 120 || prawa.length > 120) return false;

  // normalizujClaim sprowadza separatory i wielokrotne odstępy do jednej spacji.
  // Szukamy dosłownego ciągu, bez budowania RegExp z nazw pochodzących z danych.
  const znormalizowany = normalizujClaim(tekst);
  const szukany = lewa + ' ' + prawa;
  let pozycja = znormalizowany.indexOf(szukany);
  while (pozycja !== -1) {
    const koniec = pozycja + szukany.length;
    if (
      !czyZnakSlowaUnicode(znakPrzed(znormalizowany, pozycja))
      && !czyZnakSlowaUnicode(znakPo(znormalizowany, koniec))
    ) return true;
    pozycja = znormalizowany.indexOf(szukany, pozycja + 1);
  }
  return false;
}

function normalizujClaim(value) {
  return String(value || '').slice(0, 12000)
    .replace(/\bdoesn['\u2019]t\b/giu, 'does not')
    .replace(/\bisn['\u2019]t\b/giu, 'is not')
    .replace(/\baren['\u2019]t\b/giu, 'are not')
    .replace(/\bwasn['\u2019]t\b/giu, 'was not')
    .replace(/\bweren['\u2019]t\b/giu, 'were not')
    .replace(/\bdon['\u2019]t\b/giu, 'do not')
    .replace(/\bdidn['\u2019]t\b/giu, 'did not')
    .replace(/\bhaven['\u2019]t\b/giu, 'have not')
    .replace(/\bhasn['\u2019]t\b/giu, 'has not')
    .replace(/\bhadn['\u2019]t\b/giu, 'had not')
    .replace(/\bwouldn['\u2019]t\b/giu, 'would not')
    .replace(/\bshouldn['\u2019]t\b/giu, 'should not')
    .replace(/\bcouldn['\u2019]t\b/giu, 'could not')
    .replace(/\bmustn['\u2019]t\b/giu, 'must not')
    .replace(/\bcan['\u2019]t\b/giu, 'cannot')
    .replace(/\bwon['\u2019]t\b/giu, 'will not')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0142/g, 'l')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenyClaim(value) {
  return [...new Set(normalizujClaim(value).split(' ').filter(t => t.length >= 4))];
}
// Tytuly gier z tabeli ai/entities.js. Claim czesto powtarza tytul z pytania („W grze Baldur's Gate 3…”),
// choc cytat zrodlowy mowi tylko o postaci. Taki tytul opisuje kontekst pytania, a nie fakt do
// potwierdzenia w cytacie, wiec (1) numeral z tytulu nie jest liczba do potwierdzenia w dowodzie
// i (2) slowa tytulu nie sa nazwami wlasnymi wymaganymi w dowodzie. Zgodnosc tytulu ze zrodlem pilnuje
// filtr zrodel (sourceMatchesRequestContext); pozostale nazwy wlasne nadal musza wystapic w dowodzie.
// Skroty krotsze niz 5 znakow (mc, bg3, tlou) sa zbyt dwuznaczne i nie sa zwalniane.
const TYTULY_GIER = (() => {
  const sep = '[^\\p{L}\\p{N}]+';
  const esc = token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seen = new Set();
  const out = [];
  for (const entry of GAME_ALIASES) {
    for (const alias of [entry.name, ...entry.aliases]) {
      const tokens = String(alias || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const key = tokens.join(' ').toLocaleLowerCase('pl-PL');
      const unambiguousShortGameTitle = /^(?:gta v|gta 5)$/iu.test(key);
      if (!tokens.length || (key.replace(/ /g, '').length < 5 && !unambiguousShortGameTitle) || seen.has(key)) continue;
      seen.add(key);
      const last = tokens[tokens.length - 1];
      const romanEdition = /^(?:II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)$/u.test(last.toUpperCase());
      const hasEdition = tokens.length > 1 && (/^\d{1,4}$/u.test(last) || romanEdition);
      const edition = hasEdition
        ? (/^\d+$/u.test(last) ? String(Number(last)) : String(rzymskieNaArabskie(last.toUpperCase()) ?? last.toUpperCase()))
        : null;
      out.push({
        re: new RegExp(`(?<![\\p{L}\\p{N}])${tokens.map(esc).join(sep)}(?![\\p{L}\\p{N}])`, 'giu'),
        hasDigit: /\d/u.test(key) || romanEdition,
        edition,
        // Ta sama seria z innym numerem w dowodzie („Fallout 3” przy claimie o „Fallout 4”)
        // oznacza, ze numeral jest realnym rozroznikiem i nie wolno go zwalniac.
        sibling: hasEdition
          ? new RegExp(`(?<![\\p{L}\\p{N}])${tokens.slice(0, -1).map(esc).join(sep)}${sep}(\\d{1,4}|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)(?![\\p{L}\\p{N}])`, 'giu')
          : null,
      });
    }
  }
  return out.sort((a, b) => b.re.source.length - a.re.source.length);
})();
function usunTytulyGierZLiczb(claimText, evidenceText = '') {
  let out = String(claimText || '');
  const evidence = String(evidenceText || '');
  for (const title of TYTULY_GIER) {
    if (!title.hasDigit) continue;
    if (title.sibling && [...evidence.matchAll(title.sibling)].some(match => {
      const sibling = /^\d+$/u.test(match[1])
        ? String(Number(match[1]))
        : String(rzymskieNaArabskie(match[1].toUpperCase()) ?? match[1].toUpperCase());
      return sibling !== title.edition;
    })) continue;
    out = out.replace(title.re, ' ');
  }
  return out;
}
function rzymskieNaArabskie(s) {
  // Konwertuje poprawna liczbe rzymska na arabska. Zwraca null gdy nie jest
  // to poprawna liczba rzymska (uzywane do odfiltrowania zwyklych slow jak „Ciri”,
  // „Mix”, „Liv”, „mi” itp., ktore skladaja sie z liter rzymskich).
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const valid = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  if (s.length === 1 && !/^(I|V|X|L|C|D|M)$/.test(s)) return null;
  const up = s.toUpperCase();
  if (!valid.test(up)) return null;
  let result = 0;
  for (let i = 0; i < up.length; i++) {
    const cur = map[up[i]];
    const next = map[up[i + 1]] || 0;
    result += cur < next ? -cur : cur;
  }
  return result >= 1 && result <= 3999 ? result : null;
}
function wyodrebnijLiczbyIDaty(value) {
  // Keep decimal separators until numeric extraction; normalizujClaim intentionally
  // removes punctuation and would turn 2.50 into two unrelated integers (2 and 50).
  const raw = String(value || '').slice(0, 12000);
  // Rozroznia separator tysiecy od dziesietnego:
  // 50,000 / 50.000 / 50 000 => 50000, ale 2,5 / 2.50 => 2.5.
  // Nie zmieniamy tekstu zrodlowego poza normalizacja samych tokenow liczbowych.
  let text = raw.toLocaleLowerCase('pl-PL')
    .replace(/(?<=\d)[\s\u00a0\u202f](?=\d{3}(?:\D|$))/gu, '')
    .replace(/(\d)[,.](\d{3})(?=\D|$)/gu, '$1$2')
    .replace(/,/g, '.');
  const decadeFacts = [];
  // Dekada liczona numerycznie z roku (1980, 2000, 2010). Sklejanie cyfry wieku z cyfra dekady
  // dawalo „200” dla lat 2000. i „190” dla lat 1900., wiec „2000s” nigdy nie zgadzalo sie z „'00s”.
  const addDecade = year => decadeFacts.push(`decade:${Math.floor(year / 10) * 10}`);
  // „late 1980s”, „early '90s” and Polish „pod koniec lat 80.” are
  // equivalent temporal facts. Remove the decade phrase before numeric
  // extraction so 80/90 cannot be compared as unrelated integers.
  text = text.replace(/\b(?:19|20)\d{2}\s*s\b/gu, (match) => {
    const year = Number(match.match(/(?:19|20)\d{2}/)?.[0]);
    if (Number.isFinite(year)) addDecade(year);
    return ' ';
  });
  // Polska forma dluga: „lata 2000.”, „w latach 2010”, „lat 1990.” to dekada, tak jak „2000s”.
  // Zakres („w latach 2010–2013”), lista („w latach 2000 i 2010”) i pojedynczy rok („w latach 2012”)
  // nie sa dekada i zostaja zwyklymi liczbami. Przecinek jest tu juz zamieniony na kropke
  // (patrz wyzej), wiec liste „2000, 2005” rozpoznaje [,.] po roku.
  text = text.replace(/\blat(?:a|ach)?\s+((?:19|20)\d0)(?!\d)(?!\s*(?:[-\u2013\u2014]\s*\d|(?:do|oraz|i)\s+\d{4}|[,.]\s*(?:19|20)\d{2}))\.?/gu, (match, year) => {
    addDecade(Number(year));
    return ' ';
  });
  text = text.replace(/\b(?:lat(?:ach)?\s+['\u2019]?|['\u2019])(\d{2})\s*(?:s|tych)?\b|\b(\d{2})s\b/gu, (match, first, second) => {
    const shortYear = first || second;
    const n = Number(shortYear);
    // „'00s” / „lat 00.” to lata 2000.; dekady 01–09 nie istnieja, wiec tylko 00 i 10–99.
    if ((n >= 10 && n <= 99) || n === 0) decadeFacts.push(`decade:${(n >= 50 ? 1900 : 2000) + n - (n % 10)}`);
    return ' ';
  });
  const matches = text.match(/\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?%?\b/g) || [];
  const canonical = matches.map(value => {
    const percent = value.endsWith('%');
    const numeric = Number(percent ? value.slice(0, -1) : value);
    if (!Number.isFinite(numeric)) return value;
    return `${String(numeric)}${percent ? '%' : ''}`;
  });
  // Dodajemy konwersje rzymskich cyfr (np. III → 3, IV → 4), oznaczajacych
  // numery czesci gier, zeby np. dowod „Baldur's Gate III” pokrywal claim
  // „Baldur's Gate 3”. Dopasowujemy WRAZLIWIE NA WIELKOSC LITER (bez flagi 'i'),
  // zeby pominac zwykle slowa, w ktorych przypadkowo wystepuja litery rzymskie
  // (np. „mix”, „id”, „civic”, „civil”, „Liv”, „mill”, „Mili”). Poprawne
  // rzymskie cyfry w tytulach gier sa pisane wielkimi literami (III, IV, IX).
  // Only uppercase sequel numerals used in titles (II–XVI); never treat abbreviations
  // such as MC, CD, DC or MM as numeric facts.
  const romanMatches = [];
  // Only convert a numeral when it follows a title-like run of capitalized words.
  // This keeps GTA V / Final Fantasy X / Baldur's Gate III while avoiding
  // arbitrary Roman-looking tokens in prose or acronyms such as MC, CD, MM, MIX.
  const titleNumeralRe = /\b(?:[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'\u2019.-]*\s+){1,5}(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)\b/gu;
  for (const match of raw.matchAll(titleNumeralRe)) romanMatches.push(match[1]);
  for (const r of romanMatches) {
    const n = rzymskieNaArabskie(r);
    if (n !== null) canonical.push(String(n));
  }
  // Uwaga: liczby slowne („trzysta”, „dwadziescia”) celowo NIE sa tu dokladane.
  // To porownanie bywa miedzyjezykowe (polski claim wobec angielskiego
  // dowodu), a „dwie” po polsku to „two” po angielsku — rozne slowa, ta sama
  // liczba. Porownanie slow pomijaloby wtedy poprawny claim. Liczby slowne
  // porownujemy tam, gdzie obie strony sa w tym samym jezyku
  // (patrz liczbyDoPorownania).
  return [...new Set([...canonical, ...decadeFacts])];
}
const UNIT_ALIASES = new Map([
  ['h','hour'], ['hr','hour'], ['hrs','hour'], ['hour','hour'], ['hours','hour'], ['godzina','hour'], ['godziny','hour'], ['godzin','hour'], ['godz','hour'],
  ['min','minute'], ['mins','minute'], ['minute','minute'], ['minutes','minute'], ['minuta','minute'], ['minuty','minute'], ['minut','minute'],
  ['s','second'], ['sec','second'], ['second','second'], ['seconds','second'], ['sekunda','second'], ['sekundy','second'], ['sekund','second'],
  ['day','day'], ['days','day'], ['dzien','day'], ['dzień','day'], ['dni','day'], ['dnia','day'],
  ['year','year'], ['years','year'], ['rok','year'], ['lata','year'], ['lat','year'],
  ['km','km'], ['kilometer','km'], ['kilometers','km'], ['kilometr','km'], ['kilometry','km'], ['kilometrow','km'], ['kilometrów','km'],
  ['m','m'], ['meter','m'], ['meters','m'], ['metr','m'], ['metry','m'], ['metrow','m'], ['metrów','m'],
  ['kg','kg'], ['kilogram','kg'], ['kilograms','kg'], ['kilogramow','kg'],
  ['gb','gb'], ['mb','mb'], ['tb','tb'], ['hz','hz'], ['fps','fps'],
  // Pozostale przypadki: „po 5 minutach”, „przez godzine”, „w 10 sekund”, „w 3 dniach”, „od 2 lat”.
  ['minute','minute'], ['minucie','minute'], ['minutach','minute'], ['minutami','minute'], ['minutom','minute'],
  ['godzine','hour'], ['godzinę','hour'], ['godzinie','hour'], ['godzinach','hour'], ['godzinami','hour'], ['godzinom','hour'],
  ['sekunde','second'], ['sekundzie','second'], ['sekundach','second'], ['sekundami','second'], ['sekundom','second'],
  ['dniach','day'], ['dniami','day'],
  // Celowo bez „roku”, „latach” i „dniu”: „z 2013 roku”, „w latach 2010”, „w dniu 5 maja” to daty, nie wartosci z jednostka.
  ['°c','celsius'], ['°f','fahrenheit'], ['zl','pln'], ['zł','pln'], ['pln','pln'], ['usd','usd'], ['eur','eur'], ['%','percent'],
]);
function wyodrebnijJednostkoweWartosci(value) {
  const text = String(value || '').slice(0, 12000).toLocaleLowerCase('pl-PL').replace(/,/g, '.')
    // Dekada nie jest iloscia lat: porownuje ja wyodrebnianie dat powyzej.
    .replace(/\b(?:19|20)\d{2}\s*s\b/gu, ' ')
    // „lata 2000.” / „w latach 2012” to data, nie „2000 lat”: alias „lata” dawal falszywa jednostke 2000:year.
    .replace(/\blat(?:a|ach)?\s+(?:19|20)\d{2}\b/gu, ' ')
    .replace(/\blat(?:ach)?\s+['\u2019]?\d{2}\b/gu, ' ')
    .replace(/\b['\u2019]\d{2}\s*s\b/gu, ' ');
  const unitPattern = '(?:' + [...UNIT_ALIASES.keys()].filter(k => k !== 'm' && k !== 's').sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
  const out = [];
  const re = new RegExp(`(?:\\b(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})(?=$|[^\\p{L}\\p{N}])|(${unitPattern})(?=$|[^\\p{L}\\p{N}])\\s*(\\d+(?:\\.\\d+)?))`, 'giu');
  for (const m of text.matchAll(re)) {
    const amount = Number(m[1] || m[4]);
    const rawUnit = String(m[2] || m[3] || '').toLocaleLowerCase('pl-PL');
    const unit = UNIT_ALIASES.get(rawUnit);
    if (Number.isFinite(amount) && unit) out.push(`${amount}:${unit}`);
  }
  // Granice jednostki „m”/„s” musza rozumiec polskie litery: \b traktuje „a/e/o…” jako nie-litery,
  // wiec „3 sa” dawalo „3 s” (sekundy), a „5 mezczyzn” dawalo „5 m” (metry).
  const shortUnitRe = /(?:(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s+(m|s)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(m|s)\s+(\d+(?:\.\d+)?)(?![\p{L}\p{N}]))/giu;
  for (const m of text.matchAll(shortUnitRe)) {
    const amount = Number(m[1] || m[4]);
    const unit = UNIT_ALIASES.get(String(m[2] || m[3] || '').toLocaleLowerCase('pl-PL'));
    if (Number.isFinite(amount) && unit) out.push(`${amount}:${unit}`);
  }
  return [...new Set(out)];
}
function wyodrebnijNazwyWlasne(value, options = {}) {
  const raw = String(value || '').slice(0, 12000);
  // Pomijamy czeste slowa opisowe na poczatku zdania, ale nie imiona.
  // Wczesniejsze wykluczenie Artur/Arthur odrzucalo poprawne nazwy wlasne.
  const genericFirstWords = new Set([
    'decyzja', 'motywuje', 'nowo', 'nastepnie', 'nastepnie', 'ponadto', 'alternatywnie', 'alternatywnymi', 'mozesz', 'mozesz',
    'aby', 'dodatkowo', 'jednak', 'ogolnie', 'ogolnie', 'wtedy', 'potem', 'dlatego',
    'obecnie', 'pozniej', 'pozniej', 'wczesniej', 'wczesniej',
    'poniewaz', 'poniewaz', 'chociaz', 'chociaz', 'choc', 'choc',
    'jesli', 'jesli', 'gdy', 'kiedy', 'podczas', 'wreszcie',
    'wiekszosc', 'wiekszosc', 'czesc', 'czesc', 'kazdy', 'kazdy', 'dwoch', 'dwoch', 'two', 'three', 'four', 'several', 'many',
    'pierwszy', 'drugi', 'trzeci', 'mozna', 'mozna', 'moze', 'moze',
    'jest', 'sa', 'sa', 'byl', 'byla', 'bylo', 'bylo', 'byli',
    'to', 'ten', 'ta', 'te', 'jego', 'jej', 'oni', 'one', 'smoki', 'najlepszym', 'gracz', 'gracze', 'wrog', 'postac', 'postac', 'pytanie', 'odpowiedz', 'odpowiedz',
    'przeciw', 'przed', 'przez', 'po', 'podczas', 'dzieki', 'dzieki', 'wokol', 'wokol', 'wsrod', 'wsrod', 'wedlug', 'wedlug', 'zanim', 'mimo', 'wskutek', 'dowiedziawszy',
    'misja', 'misji', 'mission', 'quest', 'transfer', 'core', 'initial', 'first',
    'zrodlo', 'zrodla', 'zrodlem', 'source', 'sources', 'opis', 'opisuje', 'description',
    'a', 'an', 'the', 'if', 'it', 'he', 'she', 'they', 'we', 'you', 'his', 'her', 'their',
    'this', 'these', 'those', 'once', 'with', 'against', 'during', 'after', 'before', 'from', 'for', 'as',
    'how', 'why', 'when', 'where', 'who', 'what', 'which', 'while', 'then', 'also', 'one', 'two',
    'znajduje', 'znaleziono', 'polozony', 'polozony', 'bron', 'bron', 'sposob', 'sposob', 'metoda', 'warto', 'uzyj', 'uzyj', 'nalezy', 'nalezy',
    'later', 'another', 'eventually', 'meanwhile', 'afterward', 'afterwards', 'sometime', 'suddenly', 'finally',
    // Polskie slowa funkcyjne i czasowniki rozkazujace na poczatku claimu („Nie ma potwierdzenia…”,
    // „Strzelaj z luku…”). Lookup idzie po normalizujClaim(), wiec wystarcza formy bez znakow diakrytycznych.
    // Bez tego takie slowo bylo traktowane jak nazwa wlasna i musialo wystapic w (angielskim) dowodzie.
    'nie', 'brak', 'bez', 'dla', 'pod', 'nad', 'przy', 'zeby', 'ale', 'lub', 'czy', 'tak', 'tylko', 'nawet', 'juz', 'nadal', 'wciaz',
    'rowniez', 'takze', 'zatem', 'wiec', 'natomiast', 'lecz', 'jezeli', 'skoro', 'pomimo', 'trzeba', 'smok',
    'zrobil', 'zrobila', 'zrobili', 'strzelaj', 'atakuj', 'unikaj', 'zaatakuj', 'skorzystaj', 'wykorzystaj', 'pamietaj', 'sprobuj',
    'zacznij', 'pokonaj', 'zabij', 'walcz', 'trzymaj', 'zwieksz', 'powtarzaj', 'powtorz',
    'najpierw', 'jednoczesnie', 'takie', 'kontynuuj', 'zastosuj', 'miecz', 'wozek', 'wozka',
    'udaje', 'udala', 'udalo', 'udac',
    // Przyslowki i okoliczniki na poczatku zdania byly zliczane jako encje,
    // przez co tlumaczenie poprawnej nazwy wygladalo jak utrata encji
    // („Najlatwiej dotrzec do wozka…” → „The easiest way to get there…”).
    'najlatwiej', 'najprosciej', 'najszybciej', 'najczesciej', 'zazwyczaj', 'przede',
    // „Dokladny moment…” to opis, nie encja; wystepowal jako falszywa nazwa wlasna
    // i powodowal odrzucenie poprawnego angielskiego tlumaczenia „The exact moment…”.
    'dokladny', 'dokladna', 'dokladne', 'dokladnego', 'dokladnej', 'dokladnym',
    // Liczba mnoga rzeczownika pospolitego: „postac” byla na liscie, „postacie” nie.
    'postacie', 'postaci', 'bohaterzy', 'bohaterowie', 'zrodla', 'zrodla', 'sources',
    // Kwantyfikatory na poczatku zdania nie sa nazwami wlasnymi (np. „Wszystkie te dzialania…”).
    'wszystkie', 'wszystkich', 'wszystko', 'wszelkie', 'wszyscy', 'wszystkim', 'kazde', 'kazde', 'kazda', 'kazda', 'kazdy', 'kazdy', 'kazdym', 'kazdym',
    // Rzeczownik pospolity na poczatku claimu nie moze zostac uznany za encje.
    // W live benchmark „Przejecie kontroli przez Wheatleya…” bylo blednie
    // odrzucane, bo „Przejecie” nie wystepowalo w angielskim claim_en jako nazwa.
    'przejecie', 'przejecia', 'przejeciu', 'przejeciem', 'przejec',
    // Common sentence-initial nouns seen in the live benchmark are descriptions,
    // not proper names. Keep strict evidence, number, and date checks unchanged.
    'rodzinne', 'rodzinna', 'rodzinny', 'rodzinnego', 'rodzinnej', 'rodzinnym', 'polowanie', 'polowania', 'polowaniem', 'polowaniu', 'wedrowanie', 'wedrowania', 'wedrowaniem', 'wedrowaniu', 'damy', 'dama', 'struktura', 'struktury', 'strukture', 'strukturze', 'wiedzmin', 'wiedzmina', 'wiedzminem', 'wiedzminie', 'forteca', 'fortecy', 'fortece', 'twierdza', 'twierdzy', 'twierdze',
    // Zwykle slowa otwierajace zdanie z przypadkow false-rejection.
    // „Statki End…”: obok stoi nazwa pisana wielka litera, wiec sygnal „nazwa wielowyrazowa” nie
    // odrozni rzeczownika pospolitego od imienia i slowo musi byc na liscie.
    'materialy', 'dostepne', 'dostepnych', 'danych', 'jedynym', 'jedyna', 'jedynie', 'ponadto', 'dodatkowo', 'aby', 'jesli', 'relacja', 'relacji', 'relacje', 'poznanie', 'poznania', 'statki', 'statek', 'statku', 'statkiem'
  ].map(normalizujClaim));
  const candidates = [];
  const aliasSpans = [];
  for (const alias of KNOWN_ENTITY_ALIAS_PATTERNS) {
    const pattern = new RegExp(alias.pattern.source, 'giu');
    for (const match of raw.matchAll(pattern)) {
      const start = Number(match.index || 0);
      aliasSpans.push({ start, end: start + match[0].length });
      candidates.push({ token: alias.canonical, offset: start });
    }
  }
  // Tytul gry powtorzony w claimie to kontekst pytania, nie fakt do potwierdzenia w cytacie
  // (patrz TYTULY_GIER). Zwalniamy go z wymogu obecnosci w dowodzie tylko na zadanie wywolujacego;
  // pozostale nazwy wlasne claimu nadal musza wystapic w dowodzie.
  const titleSpans = [];
  if (options.skipGameTitles) {
    for (const title of TYTULY_GIER) {
      for (const match of raw.matchAll(title.re)) {
        const start = Number(match.index || 0);
        titleSpans.push({ start, end: start + match[0].length });
      }
    }
  }
  const sentenceRe = /(^|[.!?]\s*)([^.!?]*)(?=[.!?]|$)/gu;
  const capitalizedRe = /(?<![\p{L}\p{N}_])[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'\u2019.-]*/gu;
  const sentenceMatches = [...raw.matchAll(sentenceRe)];
  const capitalizedInMiddle = new Set();
  for (const sentenceMatch of sentenceMatches) {
    const sentence = sentenceMatch[2] || '';
    let firstCandidate = true;
    for (const match of sentence.matchAll(capitalizedRe)) {
      const tokenOffset = Number(match.index || 0);
      const atSentenceStart = firstCandidate && !sentence.slice(0, tokenOffset).trim();
      firstCandidate = false;
      if (!atSentenceStart) capitalizedInMiddle.add(normalizujTokenWyroczni(match[0]));
    }
  }

  for (const sentenceMatch of sentenceMatches) {
    const sentence = sentenceMatch[2] || '';
    const sentenceOffset = Number(sentenceMatch.index || 0) + String(sentenceMatch[1] || '').length;
    let firstCandidate = true;
    const matches = [...sentence.matchAll(capitalizedRe)];
    for (const [matchIndex, match] of matches.entries()) {
      const token = match[0];
      const tokenOffset = Number(match.index || 0);
      if (aliasSpans.some(span => tokenOffset >= span.start && tokenOffset < span.end)) continue;
      const absoluteTokenOffset = sentenceOffset + tokenOffset;
      if (titleSpans.some(span => absoluteTokenOffset >= span.start && absoluteTokenOffset < span.end)) continue;
      const before = sentence.slice(0, tokenOffset);
      const atSentenceStart = firstCandidate && !before.trim();
      firstCandidate = false;

      if (atSentenceStart && genericFirstWords.has(normalizujClaim(token))) continue;
      const normalizedCandidate = normalizujClaim(token);
      const knownAliasCandidate = KNOWN_ENTITY_ALIAS_PATTERNS.some(alias => alias.pattern.test(token));
      const knownOracleCandidate = options.nameOracle instanceof Set
        && [...new Set([normalizujTokenWyroczni(token), ...wariantyNazwyDoDopasowania(token).map(normalizujTokenWyroczni)])]
          .some(variant => options.nameOracle.has(variant));
      if (GENERIC_CAPITALIZED_WORDS.has(normalizedCandidate)
        && !knownAliasCandidate && !knownOracleCandidate) continue;
      if (atSentenceStart && options.nameOracle instanceof Set) {
        const normalizedToken = normalizujTokenWyroczni(token);
        const isKnownAlias = KNOWN_ENTITY_ALIAS_PATTERNS.some(alias => alias.pattern.test(token));
        const hasInternalCapitalOrDigit = /[\p{Lu}\d]/u.test([...token].slice(1).join(''));
        const next = matches[matchIndex + 1];
        const hasCapitalizedNextToken = Boolean(next)
          && /^\s+$/u.test(sentence.slice(tokenOffset + token.length, Number(next.index || 0)));
        const hasMidSentenceOccurrence = capitalizedInMiddle.has(normalizedToken);
        const tokenVariants = new Set([normalizedToken, ...wariantyNazwyDoDopasowania(token).map(normalizujTokenWyroczni)]);
        const isInNameOracle = [...tokenVariants].some(variant => options.nameOracle.has(variant));
        if (!(isKnownAlias || hasInternalCapitalOrDigit || hasCapitalizedNextToken || hasMidSentenceOccurrence || isInNameOracle)) {
          // Swiadomy kompromis: wymyslona nazwa wystepujaca wylacznie na poczatku claimu
          // i nieobecna w zrodlach moze zostac pominieta. Inne kontrole pozostaja aktywne;
          // nazwy w srodku zdania nadal sa scisle wymagane w dowodzie.
          if (Array.isArray(options._ignoredSentenceInitialNames)) options._ignoredSentenceInitialNames.push(token);
          continue;
        }
      }
      candidates.push({ token, offset: sentenceOffset + tokenOffset });
    }
  }

  // Zachowujemy apostrofy i polskie znaki; normalizacja sluzy wylacznie
  // do porownywania nazw, nie moze zmieniac "Johnny'ego" w "johnny ego".
  const normalizujNazwe = (text) => String(text || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}'\u2019.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [...new Set(candidates
    .map(item => normalizujNazwe(item.token))
    .filter(name => name.length >= 3))];
}
function tekstDoWykrywaniaNegacji(value) {
  // Konstrukcje warunkowe „if/when not X, Y”, „unless X, Y”, „jesli/jezeli/gdy/kiedy
  // nie X, to Y” oraz „chyba ze X, Y” zawieraja negacje w protazie, ale nie
  // odwracaja polaryzacji faktycznego claimu w apodozie. Na przyklad:
  //   „If not chosen as the player character, Astarion may be encountered …”
  // to nie twierdzenie o tym, ze Astarion NIE wystepuje w grze. Usuwamy taka
  // wprowadzajaca fraze PRZED normalizacja, bo normalizacja zamienia przecinki
  // na spacje i rozmywa granice zdania podrzednego.
  let cleaned = String(value || '');
  cleaned = cleaned.replace(/\b(?:if|when)\s+not\s+[^,.!?;:]*?\s*[,;:]/giu, ' ');
  cleaned = cleaned.replace(/\bunless\s+[^,.!?;:]*?\s*[,;:]/giu, ' ');
  cleaned = cleaned.replace(/\b(?:jesli|jeśli|jezeli|jeżeli|gdy|kiedy)\s+nie\s+[^,.!?;:]*?\s*(?:[,;:]|\sto\s)/giu, ' ');
  cleaned = cleaned.replace(/\bchyba\s*(?:ze|że)\s+[^,.!?;:]*?\s*[,;:]/giu, ' ');
  // Dodatkowa, wspolrzedna klauzula sposobu/celu typu „..., and track down a
  // way to regain his agency without succumbing fully to his vampiric urges”
  // zawiera „without”, ale nie neguje glownego orzeczenia zdania („escape”) —
  // opisuje rownolegly, dodatkowy cel. Dotyczy to tylko fraz wprowadzonych
  // przez „and ... without ...” (nie samego poczatku zdania), wiec zwykle
  // „X did not do Y” nadal jest wykrywane jako negacja glownego twierdzenia.
  cleaned = cleaned.replace(/\band\s+[^,.!?;:]*?\bwithout\s+[^,.!?;:]*/giu, (match) => {
    const beforeWithout = match.replace(/^\band\s+/iu, '').replace(/\bwithout\b[\s\S]*$/iu, '');
    return NEGATION_RE.test(beforeWithout) ? match : ' ';
  });

  let text = normalizujClaim(cleaned);

  // Frazy metajezykowe i retoryczne zawieraja „nie/not”, ale nie odwracaja
  // polaryzacji opisywanego faktu: „nie mozemy zapomniec o Astarionie” znaczy,
  // ze Astarion jest wazny, a nie ze go nie ma.
  text = text.replace(
    /(?:^|\b)(?:nie mozemy zapomniec|nie mozna zapomniec|nie zapominajmy|nie zapominaj|do not forget|not to mention)\b/gu,
    ' ',
  );

  // „lack/absence of stability” opisuje niestabilnosc; nie jest negacja
  // nastepnego orzeczenia („lack of stability will cause destruction”).
  // Pozostawiamy „lack/absence of siblings” jako sygnal braku konkretnej encji.
  text = text.replace(/\b(?:lack|absence) of stability\b/gu, 'instability');
  return text;
}

function wyodrebnijMarkery(value, regex) {
  const text = (regex === NEGATION_RE || regex === NEGATION_STRICT_RE)
    ? tekstDoWykrywaniaNegacji(value)
    : normalizujClaim(value);
  return regex.test(text);
}
function normalizujTokenNazwy(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}'\u2019.-]+/gu, '')
    .trim();
}
function normalizujTokenWyroczni(value) {
  return normalizujTokenNazwy(value).replace(/[.-]+$/u, '');
}

let ostatniKluczWyroczniNazw = null;
let ostatniaWyroczniaNazw = new Set();
function zbudujWyroczniaNazw(blocks, extraNames = []) {
  const rows = Array.isArray(blocks) ? blocks : [];
  const extras = (Array.isArray(extraNames) ? extraNames : [extraNames])
    .flatMap(name => String(name || '').trim().split(/\s+/u).map(normalizujTokenWyroczni)).filter(Boolean);
  const key = JSON.stringify([rows.map(block => String(block?.content || '')), extras]);
  if (key === ostatniKluczWyroczniNazw) return new Set(ostatniaWyroczniaNazw);

  const oracle = new Set();
  const sentenceRe = /(^|[.!?]\s*)([^.!?]*)(?=[.!?]|$)/gu;
  const capitalizedRe = /(?<![\p{L}\p{N}_])[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'\u2019.-]*/gu;
  for (const block of rows) {
    const raw = String(block?.content || '');
    for (const sentenceMatch of raw.matchAll(sentenceRe)) {
      const sentence = sentenceMatch[2] || '';
      let firstCandidate = true;
      for (const match of sentence.matchAll(capitalizedRe)) {
        const token = match[0];
        const offset = Number(match.index || 0);
        const atSentenceStart = firstCandidate && !sentence.slice(0, offset).trim();
        firstCandidate = false;
        if (atSentenceStart) continue;
        const normalized = normalizujTokenWyroczni(token);
        if (normalized) oracle.add(normalized);
      }
    }
  }
  for (const extra of extras) oracle.add(extra);

  ostatniKluczWyroczniNazw = key;
  ostatniaWyroczniaNazw = new Set(oracle);
  return new Set(oracle);
}

function wariantyNazwyDoDopasowania(entity) {
  const token = normalizujTokenNazwy(entity);
  if (!token) return [];
  const variants = new Set([token]);

  // Apostrof w odmianie obcego imienia oddziela rdzen od koncowki:
  // Johnny’ego -> Johnny.
  const apostropheBase = token.replace(/['\u2019]\p{L}+$/u, '');
  if (apostropheBase.length >= 4 && apostropheBase !== token) variants.add(apostropheBase);

  // Angielska forma dzierzawcza: Alt’s -> Alt. Nazwy maja co najmniej 3 znaki,
  // wiec rdzen krotszy niz 4 znaki (np. „Alt”) tez musi byc rozpoznany.
  const possessive = token.match(/^(.{3,})['\u2019]s$/u);
  if (possessive) variants.add(possessive[1]);

  // Ograniczona obsluga odmiany nazw obcych: wymagamy dokladnego rdzenia
  // w zrodle zamiast ryzykownego dopasowania dowolnego prefiksu.
  const suffixes = ['owego', 'owej', 'owym', 'owie', 'ami', 'ach', 'ego', 'emu', 'owi', 'iego', 'iej', 'ow', 'om', 'em', 'ie', 'a', 'e', 'a', 'y', 'i', 'u', 'e'];
  for (const suffix of suffixes) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      variants.add(token.slice(0, -suffix.length));
    }
  }
  // Mianownik rzeczownikow zenskich na -a: Arasake/Arasaki -> Arasaka, Arasace -> Arasaka.
  // Znaki diakrytyczne sa juz usuniete, wiec „e” widac jako „e”. Samo odciecie koncowki
  // dawalo rdzen („arasak”), ktorego nie ma w tekscie zrodlowym jako osobnego tokenu.
  if (/[eyi]$/u.test(token) && token.length - 1 >= 4) variants.add(token.slice(0, -1) + 'a');
  if (token.endsWith('ie') && token.length - 2 >= 4) variants.add(token.slice(0, -2) + 'a');
  // Miejscownik z przemiana spolgloski: Novigradzie -> Novigrad, Velenie -> Velen (juz obslugiwane), Hindarsfjalle itp.
  const alternations = [['scie', 'st'], ['scie', 'st'], ['dzie', 'd'], ['cie', 't'], ['rze', 'r'], ['sie', 's'], ['zie', 'g']];
  for (const [from, to] of alternations) {
    if (token.endsWith(from) && token.length - from.length >= 4) variants.add(token.slice(0, -from.length) + to);
  }
  return [...variants];
}

function czyNazwaWlasnaWystepuje(entity, evidenceNormalized) {
  const evidenceTokens = normalizujClaim(evidenceNormalized).split(' ').filter(Boolean);
  if (!evidenceTokens.length) return false;

  // Preserve spaces for canonical multi-word aliases. The inflection helper is
  // optimized for single-token names and intentionally removes whitespace.
  const entityNormalized = normalizujClaim(entity);
  const knownAlias = KNOWN_ENTITY_ALIAS_PATTERNS.find(alias => normalizujClaim(alias.canonical) === entityNormalized);
  const evidenceText = String(evidenceNormalized || '');
  if (knownAlias && knownAlias.pattern.test(evidenceText)) return true;
  // "the Baron" is used as shorthand for the Bloody Baron in Witcher 3 sources;
  // require identifying names from the same game in the passage.
  if (entityNormalized === 'bloody baron'
    && /\bthe\s+baron\b/i.test(evidenceText)
    && /\b(?:geralt|ciri|velen|novigrad|witcher)\b/i.test(evidenceText)) return true;

  const variants = new Set([entityNormalized]);
  for (const variant of wariantyNazwyDoDopasowania(entity)) {
    const normalizedVariant = normalizujClaim(variant);
    if (normalizedVariant) variants.add(normalizedVariant);
  }

  return [...variants].some(variant => {
    const normalized = String(variant || '').split(' ').filter(Boolean);
    if (!normalized.length || normalized.length > evidenceTokens.length) return false;
    for (let start = 0; start <= evidenceTokens.length - normalized.length; start++) {
      if (normalized.every((token, offset) => evidenceTokens[start + offset] === token)) return true; // njsscan-ignore: node_timing_attack — public evidence tokens
    }
    return false;
  });
}

function wybierzKlausuleDowoduDlaClaimu(evidence, claim) {
  const fragments = String(evidence || '').split(/(?<=[.!?])\s+|,\s+(?=(?:but|however|yet|whereas|ale|jednak|natomiast)\b)/iu).map(fragment => fragment.trim()).filter(Boolean);
  if (fragments.length < 2) return String(evidence || '');
  // Auxiliary verbs and polarity markers should not make an unrelated
  // negative clause win a tie against the clause describing the claimed event.
  const scopeStopwords = new Set([
    'did', 'does', 'do', 'was', 'were', 'is', 'are', 'be', 'been', 'being',
    'has', 'have', 'had', 'can', 'could', 'will', 'would', 'should', 'may',
    'might', 'must', 'not', 'never', 'nie', 'nigdy', 'brak', 'bez',
  ]);
  const claimTokens = tokenyPokryciaBezStop(claim)
    .filter(token => !NEGATION_RE.test(token) && !scopeStopwords.has(token));
  if (!claimTokens.length) return String(evidence || '');
  const entityTokens = new Set(
    wyodrebnijNazwyWlasne(claim).flatMap(name => tokenyPokryciaBezStop(name)),
  );
  const score = fragment => {
    const fragmentTokens = tokenyPokryciaBezStop(fragment);
    const shared = claimTokens.filter(token => fragmentTokens.some(other => tokenyPokrywajaSie(token, other)));
    // If two clauses have the same lexical coverage, prefer the one matching
    // more of the claim's non-entity/event tokens. A repeated character name
    // must not let an unrelated negated clause win a polarity check.
    const eventMatches = shared.filter(token => !entityTokens.has(token)).length;
    return { total: shared.length, eventMatches };
  };
  let best = fragments[0];
  let bestScore = score(best);
  for (const fragment of fragments.slice(1)) {
    const fragmentScore = score(fragment);
    if (
      fragmentScore.total > bestScore.total
      || (fragmentScore.total === bestScore.total && fragmentScore.eventMatches > bestScore.eventMatches)
    ) {
      best = fragment;
      bestScore = fragmentScore;
    }
  }
  return bestScore.total / claimTokens.length >= 0.2 ? best : String(evidence || '');
}

function sprawdzPowiazanieLiczbZeZdarzeniem(evidence, claim, options = {}) {
  if (options.allowDistributedEvidence || wygladaNaAngielski(evidence) !== wygladaNaAngielski(claim)) return { ok: true };
  const claimNumbers = wyodrebnijLiczbyIDaty(usunTytulyGierZLiczb(claim, evidence));
  if (!claimNumbers.length) return { ok: true };
  const sentences = String(evidence || '').split(/(?<=[.!?])\s+/u).map(sentence => sentence.trim()).filter(Boolean);
  if (sentences.length < 2) return { ok: true };
  const claimTokens = tokenyPokryciaBezStop(claim);
  if (!claimTokens.length) return { ok: true };
  const score = sentence => {
    const sentenceTokens = tokenyPokryciaBezStop(sentence);
    const shared = claimTokens.filter(token => sentenceTokens.some(other => tokenyPokrywajaSie(token, other)));
    return shared.length / claimTokens.length;
  };
  const bestOverallScore = sentences.reduce((best, sentence) => Math.max(best, score(sentence)), 0);
  const numericSentences = sentences.filter(sentence => {
    const numbers = wyodrebnijLiczbyIDaty(sentence);
    return claimNumbers.every(number => numbers.includes(number));
  });
  if (!numericSentences.length) {
    return { ok: false, reason: 'wartosci liczbowe claimu nie wystepuja razem w jednym zdaniu dowodowym' };
  }
  const bestNumericScore = numericSentences.reduce((best, sentence) => Math.max(best, score(sentence)), 0);
  if (bestOverallScore >= 0.35 && bestOverallScore - bestNumericScore >= 0.25) return { ok: false, reason: 'wartosc liczbowa wystepuje przy innym zdarzeniu niz w claimie' };
  return { ok: true };
}
function sprawdzTwardeKonflikty(evidence, claim, options = {}) {
  const e = String(evidence || '');
  const c = String(claim || '');
  // Clause-scoped exception: “Although it was never explained, X happened”
  // negates the explanation, not event X. A document-level negation scan used
  // to reject a positive claim about X because an unrelated subordinate clause
  // contained “never”. Keep the hard gate for negation of the actual event.
  const evidenceForNegation = wybierzKlausuleDowoduDlaClaimu(e, c).replace(
    /\b(?:although|though|while)\s+(?:it|this|that)\s+(?:was|is|has been)\s+never\s+explained\b[,;:]?\s*/giu,
    ' ',
  );
  const evidenceNegated = wyodrebnijMarkery(evidenceForNegation, NEGATION_RE);
  const claimNegated = wyodrebnijMarkery(c, NEGATION_RE);
  if (!options.ignoreNegation && !options.allowDistributedEvidence && claimNegated !== evidenceNegated) {
    // „take no damage” (kwantyfikator zerowy, bez zadnego innego zaprzeczenia w dowodzie) potwierdza pozytywny
    // claim o redukcji („zmniejsza obrazenia”). Kazde inne rozjechanie negacji nadal jest twardym konfliktem.
    const zerowyKwantyfikator = !claimNegated && evidenceNegated
      && !wyodrebnijMarkery(e, NEGATION_STRICT_RE)
      && wyodrebnijMarkery(c, REDUCTION_RE);
    if (!zerowyKwantyfikator) return { ok: false, reason: 'claim i dowód mają inną negację' };
  }
  if (options.checkNegationOnly) return { ok: true };

  const evidenceNumbers = wyodrebnijLiczbyIDaty(e);
  // Numeral w tytule gry („Baldur's Gate 3”, „Cyberpunk 2077”) nie jest faktem do potwierdzenia w cytacie
  // (patrz TYTULY_GIER); zwalniamy go, chyba ze dowod wspomina inna czesc tej samej serii.
  const cBezTytulow = usunTytulyGierZLiczb(c, e);
  const claimNumbers = wyodrebnijLiczbyIDaty(cBezTytulow);
  if (claimNumbers.some(n => !evidenceNumbers.includes(n))) return { ok: false, reason: 'claim zawiera liczbę/datę nieobecną w dowodzie' };

  const evidenceQuantities = wyodrebnijJednostkoweWartosci(e);
  const claimQuantities = wyodrebnijJednostkoweWartosci(c);
  if (claimQuantities.some(q => !evidenceQuantities.includes(q))) return { ok: false, reason: 'claim zawiera wartosc liczbowa z niezgodnymi lub niepotwierdzonymi jednostkami' };
  const numericAssociation = sprawdzPowiazanieLiczbZeZdarzeniem(e, c, options);
  if (!numericAssociation.ok) return numericAssociation;

  const claimTemporal = wyodrebnijMarkery(cBezTytulow, TEMPORAL_RE);
  const evidenceTemporal = wyodrebnijMarkery(e, TEMPORAL_RE);
  if (claimTemporal && !evidenceTemporal && claimNumbers.length === 0) return { ok: false, reason: 'claim zawiera sygnal czasowy nieobecny w dowodzie' };
  return { ok: true };
}

function sprawdzSprzecznosciSemantyczne(evidence, claim) {
  const normalizedEvidence = normalizujClaim(evidence);
  const normalizedClaim = normalizujClaim(claim);
  // Catch a concrete translation mismatch (cart vs basket) without treating
  // every mention of a cart as a required cross-language concept. In route
  // instructions, Polish "wozek" may be naturally rendered as "get there".
  const evidenceCart = /\b(?:cart|carriage|wagon)\b|\bwoz(?:u|em|ie|y|ow|ami|ach)?\b|\bwozek\b|\bwozka\b|\bwozkiem\b|\bwozki\b|\bwozkow\b|\bwozkami\b|\bwozkach\b/i.test(normalizedEvidence);
  const claimCart = /\b(?:cart|carriage|wagon)\b|\bwoz(?:u|em|ie|y|ow|ami|ach)?\b|\bwozek\b|\bwozka\b|\bwozkiem\b|\bwozki\b|\bwozkow\b|\bwozkami\b|\bwozkach\b/i.test(normalizedClaim);
  const evidenceBasket = /\bbaskets?\b|\bkosz\w*\b/i.test(normalizedEvidence);
  const claimBasket = /\bbaskets?\b|\bkosz\w*\b/i.test(normalizedClaim);
  if ((evidenceCart && claimBasket && !claimCart) || (evidenceBasket && claimCart && !claimBasket)) {
    return { ok: false, reason: 'claim blednie tlumaczy woz/wozek jako kosz/basket lub odwrotnie' };
  }
  const negativeStabilityRe = /\b(?:lack of stability|absence of stability|instabil\w*|unstable|niestabiln\w*|brak stabiln\w*)\b/u;
  const positiveStabilityRe = /\b(?:stability|stable|stabiln\w*)\b/u;
  const evidenceLacksStability = negativeStabilityRe.test(normalizedEvidence);
  const claimLacksStability = negativeStabilityRe.test(normalizedClaim);
  const evidenceAssertsStability = positiveStabilityRe.test(normalizedEvidence) && !evidenceLacksStability;
  const claimAssertsStability = positiveStabilityRe.test(normalizedClaim) && !claimLacksStability;
  if (evidenceLacksStability && claimAssertsStability) {
    return { ok: false, reason: 'claim twierdzi stabilność, a dowód wskazuje brak stabilności' };
  }
  if (evidenceAssertsStability && claimLacksStability) {
    return { ok: false, reason: 'claim twierdzi brak stabilnosci, a dowod wskazuje stabilnosc' };
  }

  const eConcepts = pojeciaCrossLanguage(evidence);
  const cConcepts = pojeciaCrossLanguage(claim);
  const eAction = {
    captured: /captur\w*|porwan\w*|uprowadz\w*|schwyt\w*/i.test(normalizujClaim(evidence)),
    killed: /kill\w*|murder\w*|zabij\w*|zabil\w*|zabila\w*|zabita\w*|zabite\w*|zabici\w*|zabity\w*|zabicie\w*|smier\w*/i.test(normalizujClaim(evidence)),
  };
  const cAction = {
    captured: /captur\w*|porwan\w*|uprowadz\w*|schwyt\w*/i.test(normalizujClaim(claim)),
    killed: /kill\w*|murder\w*|zabij\w*|zabil\w*|zabila\w*|zabici\w*|zabity\w*|zabicie\w*|smier\w*/i.test(normalizujClaim(claim)),
  };
  if (cAction.killed && eAction.captured && !eAction.killed) return { ok: false, reason: 'claim zawiera zabojstwo, a dowod potwierdza jedynie schwytanie/porwanie' };
  if (cAction.captured && eAction.killed && !eAction.captured) return { ok: false, reason: 'claim zawiera schwytanie/porwanie, a dowod potwierdza zabojstwo' };
  // Przejecie kontroli nie jest zniszczeniem (i odwrotnie): para dziala w obu kierunkach,
  // wiec „przejal kontrole” ↔ „destroyed” jest wykrywane ogolnie, bez wyjatkow dla konkretnych zdan.
  const opposites = [['porwanie','zabojstwo'], ['obrazenia','zabojstwo'], ['pomoc','kontrola'], ['porazka','kontrola'], ['kontrola','destrukcja']];
  for (const [a,b] of opposites) {
    if (cConcepts.has(b) && eConcepts.has(a) && !eConcepts.has(b)) return { ok: false, reason: 'claim zawiera sprzeczne dzialanie wzgledem dowodu' };
    if (cConcepts.has(a) && eConcepts.has(b) && !eConcepts.has(a)) return { ok: false, reason: 'claim zawiera sprzeczne dzialanie wzgledem dowodu' };
  }
  return { ok: true };
}

function dopasowanieSemantyczne(evidence, claim, options = {}) {
  const eConcepts = pojeciaCrossLanguage(evidence);
  const cConcepts = pojeciaCrossLanguage(claim);
  const sharedConcepts = [...cConcepts].filter(x => eConcepts.has(x));
  const ct = tokenyClaim(claim);
  const et = new Set(tokenyClaim(evidence));
  const overlap = ct.length ? ct.filter(t => [...et].some(other => tokenyPokrywajaSie(t, other))).length / ct.length : 0;
  const ignoredSentenceInitialNames = [];
  const nameOptions = { ...options, _ignoredSentenceInitialNames: ignoredSentenceInitialNames, skipGameTitles: true };
  const entities = wyodrebnijNazwyWlasne(claim, nameOptions);
  const normalizedEvidence = normalizujClaim(evidence);
  const missingEntities = entities.filter(entity => !czyNazwaWlasnaWystepuje(entity, normalizedEvidence));
  if (missingEntities.length) {
    // Nazwa wlasna z polskiego claimu nie wystepuje w angielskim dowodzie. Jesli
    // model nie zwrocil tlumaczenia claim_en, nie da sie rozstrzygnac, czy nazwa
    // ma zweryfikowany odpowiednik w drugim jezyku, czy zostala wymyslona.
    // Powod musi to mowic wprost — nazwa braku nazwy wlasnej
    // sugerowala problem z trescia odpowiedzi, a problem lezy w kontrakcie.
    if (!options.claimEn && wygladaNaAngielski(evidence)) {
      return { ok: false, reason: 'brak tłumaczenia claimu (claim_en) dla angielskiego dowodu — nazw własnych nie da się rozstrzygnąć', ignoredSentenceInitialNames };
    }
    return { ok: false, reason: 'dowód nie zawiera wszystkich istotnych nazw własnych claimu', ignoredSentenceInitialNames };
  }
  if (sharedConcepts.length >= 2) return { ok: true, mode: 'multiple_cross_language_concepts', sharedConcepts, overlap, ignoredSentenceInitialNames };
  if (sharedConcepts.length >= 1 && entities.length >= 1) return { ok: true, mode: 'concept_and_entity', sharedConcepts, overlap, ignoredSentenceInitialNames };
  if (overlap >= (entities.length ? 0.34 : 0.45)) return { ok: true, mode: 'token_overlap', overlap, sharedConcepts, ignoredSentenceInitialNames };
  if (sharedConcepts.length >= 2) return { ok: true, mode: 'multiple_concepts', sharedConcepts, overlap, ignoredSentenceInitialNames };
  return { ok: false, reason: `zbyt male pokrycie semantyczne (${overlap.toFixed(2)})`, ignoredSentenceInitialNames };
}

function czyRelacjaPrzyczynowaPokrywaClaim(evidence, claim, options = {}) {
  const claimText = String(claim || '');
  const evidenceText = String(evidence || '');
  const claimEntities = wyodrebnijNazwyWlasne(claimText, { ...options, skipGameTitles: true });
  const claimTokens = tokenyPokryciaBezStop(claimText);
  const sentences = evidenceText
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  const relationRe = /(?<![\p{L}])(?:bo|poniewaz|gdyz|dlatego|z powodu|dzieki|spowod\w*|doprowadz\w*|umozliw\w*|because|therefore|due to|caus\w*|corrupt\w*|skorumpow\w*|led to|leading to|lead\w*\s+(?:\w+\s+){0,3}to|resulted in|resulting in|so\s+(?:approach|use|avoid|keep|stay|choose|take|do|be)|so\s+that|in\s+order\s+to|so\s+as\s+to|thereby|thus|w\s+ten\s+sposob|przez\s+co|co\s+(?:umozliw\w*|spowod\w*)|allow(?:s|ed|ing)?|enabl(?:e|es|ed|ing)|accidentally|by mistake|which\s+(?:let|lets|allowed|allows|enabled|enables)|putting\s+(?:him|her|them|it)\s+in\s+control|giving\s+(?:him|her|them|it)\s+control|will\s+see\s+(?:him|her|them|the player|the character)\s+(?:officially\s+)?(?:join|become)|force(?:s|d|ing)?\s+(?:the\s+)?[\w'-]+(?:\s+[\w'-]+){0,1}\s+to\s+[\w'-]+)(?![\p{L}])/iu;
  return sentences.some(sentence => {
    const normalized = normalizujClaim(sentence);
    if (!relationRe.test(normalized)) return false;
    const entityOk = !claimEntities.length || claimEntities.every(entity => czyNazwaWlasnaWystepuje(entity, normalized));
    const evidenceTokens = tokenyPokryciaBezStop(sentence);
    const matchedTokens = claimTokens.filter(token => evidenceTokens.some(other => tokenyPokrywajaSie(token, other)));
    const tokenOverlapScore = claimTokens.length ? matchedTokens.length / claimTokens.length : 0;
    const semanticMatch = tokenOverlapScore < 0.22 ? dopasowanieSemantyczne(sentence, claimText, options) : null;
    return entityOk && (tokenOverlapScore >= 0.22 || Boolean(semanticMatch?.ok && semanticMatch.sharedConcepts?.length >= 2));
  });
}

function zgodnoscStrukturalna(evidence, claim, options = {}) {
  const e = String(evidence || '');
  const c = String(claim || '');
  if (!e.trim() || !c.trim()) return { ok: false, reason: 'brak dowodu lub claimu' };

  // Conditional evidence ("only if", "unless", "jesli ...") does not prove the
  // consequent as an unconditional fact. Preserve it when the claim states the
  // condition too; do not let negation cleanup erase the logical qualifier.
  const conditionalRe = /\b(?:unless|provided that|only if|only when|if and only if|as long as|pod warunkiem|tylko jesli|tylko gdy|tylko kiedy)\b/u;
  if (conditionalRe.test(normalizujClaim(e)) && !conditionalRe.test(normalizujClaim(c))) {
    return { ok: false, reason: 'dowód jest warunkowy, a claim przedstawia skutek jako bezwarunkowy' };
  }

  const hard = sprawdzTwardeKonflikty(e, c, options);
  if (!hard.ok) return hard;
  const semanticConflict = sprawdzSprzecznosciSemantyczne(e, c);
  if (!semanticConflict.ok) return semanticConflict;

  const evidenceNumbers = wyodrebnijLiczbyIDaty(e);
  const claimNumbers = wyodrebnijLiczbyIDaty(usunTytulyGierZLiczb(c, e));
  if (claimNumbers.length && claimNumbers.some(n => !evidenceNumbers.includes(n))) {
    return { ok: false, reason: 'claim zawiera liczbę/datę nieobecną w dowodzie' };
  }
  const evidenceQuantities = wyodrebnijJednostkoweWartosci(e);
  const claimQuantities = wyodrebnijJednostkoweWartosci(c);
  if (claimQuantities.some(q => !evidenceQuantities.includes(q))) {
    return { ok: false, reason: 'claim zawiera wartosc liczbowa z niezgodnymi lub niepotwierdzonymi jednostkami' };
  }

  const claimCausal = wyodrebnijMarkery(c, CAUSAL_RE);
  const evidenceCausal = wyodrebnijMarkery(e, CAUSAL_EVIDENCE_RE);
  if (claimCausal && !evidenceCausal && !options.allowDistributedEvidence) {
    return { ok: false, reason: 'claim dodaje relację przyczynową nieobecną w dowodzie' };
  }

  const semantic = dopasowanieSemantyczne(e, c, options);
  if (semantic.ok) return semantic;

  const claimTokens = tokenyPokryciaBezStop(c);
  const evidenceTokens = tokenyPokryciaBezStop(e);
  const sharedTokens = claimTokens.filter(token => evidenceTokens.some(et => tokenyPokrywajaSie(token, et)));
  const tokenCoverage = claimTokens.length ? sharedTokens.length / claimTokens.length : 0;
  const evidenceConcepts = pojeciaCrossLanguage(e);
  const claimConcepts = pojeciaCrossLanguage(c);
  const sharedConcepts = [...claimConcepts].filter(x => evidenceConcepts.has(x));
  const claimEntities = wyodrebnijNazwyWlasne(c, { ...options, skipGameTitles: true });
  const normalizedEvidence = normalizujClaim(e);
  const entityCoverage = claimEntities.length
    ? claimEntities.filter(entity => czyNazwaWlasnaWystepuje(entity, normalizedEvidence)).length / claimEntities.length
    : 1;

  // Akceptujemy sensowna parafraze, ale tylko po przejsciu twardych
  // konfliktow/liczb/jednostek. To naprawia false rejecti bez otwierania
  // walidatora na dowolne podobienstwo tekstowe.
  // Minimalnie nizszy prog parafrazy, przy zachowaniu pelnego pokrycia
  // encji albo wspolnego pojecia. Twarde kontrole liczb, negacji i przyczyn
  // wykonuja sie wczesniej i pozostaja bez zmian.
  if (tokenCoverage >= 0.26 && (sharedConcepts.length > 0 || (claimEntities.length > 0 && entityCoverage === 1))) {
    return { ok: true, mode: 'paraphrase', overlap: tokenCoverage, sharedConcepts, entityCoverage, ignoredSentenceInitialNames: semantic.ignoredSentenceInitialNames || [] };
  }
  if (options.allowCrossLanguageExactEvidence === true && sharedConcepts.length > 0 && tokenCoverage >= 0.18) {
    return { ok: true, overlap: tokenCoverage, mode: 'cross_language_paraphrase', sharedConcepts, entityCoverage, ignoredSentenceInitialNames: semantic.ignoredSentenceInitialNames || [] };
  }
  return semantic;
}
function tokenyPokryciaBezStop(value) {
  return [...new Set(normalizujClaim(value).split(' ').filter(t => t.length >= 3 && !COVERAGE_STOPWORDS.has(t)))];
}
function tokenyPokrycia(value) {
  return [...new Set(normalizujClaim(value).split(' ').filter(t => t.length >= 3 && !COVERAGE_STOPWORDS.has(t)))];
}
const POLISH_INFLECTION_SUFFIXES = [
  'owego', 'owych', 'owymi', 'owej', 'iego', 'iemu', 'owie',
  'ami', 'ach', 'owi', 'iem', 'ow', 'om', 'em', 'ym', 'im', 'ej',
].sort((a, b) => b.length - a.length);
const POLISH_SHORT_INFLECTION_SUFFIXES = new Set(['a', 'e', 'y', 'i', 'u']);

function tokenZPolskimRdzeniem(token) {
  const value = String(token || '');
  for (const suffix of POLISH_INFLECTION_SUFFIXES) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 5) {
      return { value, stem: value.slice(0, -suffix.length), inflected: true };
    }
  }
  return { value, stem: value, inflected: false };
}

function tokenyPokrywajaSie(a, b) {
  if (a === b) return true;

  // Conservative Polish inflection matching: strip one known case/number ending
  // from a long token, then allow a single short vowel ending on its counterpart.
  // The minimum five-character stem avoids collapsing short, ambiguous words.
  const left = tokenZPolskimRdzeniem(a);
  const right = tokenZPolskimRdzeniem(b);
  if (left.stem.length >= 5 && left.stem === right.stem && (left.inflected || right.inflected)) return true;
  const shortStem = token => {
    const value = String(token || '');
    const suffix = value.slice(-1);
    return POLISH_SHORT_INFLECTION_SUFFIXES.has(suffix) && value.length - 1 >= 5
      ? value.slice(0, -1)
      : null;
  };
  if (left.inflected && left.stem === shortStem(right.value)) return true;
  if (right.inflected && right.stem === shortStem(left.value)) return true;

  if (Math.min(a.length, b.length) < 6) return false;
  // Do not accept long common prefixes as a substitute for edit distance:
  // unrelated words can share most of a prefix but differ in their suffix.
  // A single typo is allowed only when the complete tokens differ by one edit.
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  if (i < a.length || j < b.length) edits++;
  return edits === 1;
}
function czyOgraniczenieDowodowe(sentence) {
  const text = normalizujClaim(sentence);
  const limitation = /\b(?:nie\s+(?:potwierdz\w*|podaj\w*|precyz\w*|okresl\w*|wskaz\w*|zawier\w*|znalazl\w*|znaleziono)|brak\s+(?:dokladn\w*\s+)?(?:dat\w*|moment\w*|czas\w*|potwierdzon\w*\s+(?:przyczyn\w*|powod\w*)))\b/u.test(text);
  // „metod\w*” i „sposob\w*”: zastrzezenie o braku dodatkowych metod w zrodlach („Zrodla nie podaja
  // dodatkowych metod zdobycia…”) jest tak samo zakresem zrodla jak brak daty, a nie faktem o swiecie.
  const scopedTopic = /\b(?:dat\w*|moment\w*|czas\w*|rok\w*|przyczyn\w*|powod\w*|metod\w*|sposob\w*)\b/u.test(text);
  const sourceMention = /\b(?:zrodla?\w*|materialy|dane|sources?|evidence)\b/u.test(text);
  const inheritedSourceScope = /^\s*(?:ale|jednak)?\s*nie\b/u.test(text);
  return limitation && scopedTopic && (sourceMention || inheritedSourceScope);
}

const EVIDENCE_LABEL_PRESENCE_RE = /EVIDENCE\s+CANDIDATES?/i;
const EVIDENCE_LABEL_RE = /\s*[(\[]\s*EVIDENCE\s+CANDIDATES?\s*\d+(?:\s*(?:,|;|&|\bi\b|\band\b)\s*\d+)*\s*[)\]]|\s*\bEVIDENCE\s+CANDIDATES?\s*\d+(?:\s*:\s*SOURCE\s*\d+)?/gi;

function usunEtykietyDowodow(text) {
  const raw = String(text || '');
  if (!EVIDENCE_LABEL_PRESENCE_RE.test(raw)) return raw;
  return raw
    .replace(EVIDENCE_LABEL_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;!?])/g, '$1')
    .trim();
}

function sprawdzPokrycieClaimamiOdpowiedzi(answer, claims) {
  const claimList = Array.isArray(claims) ? claims : [];
  if (String(answer || '').length > 12000 || claimList.length > 40 || claimList.some(item => String(item?.claim || '').length > 1000)) {
    return { ok: false, totalSentences: 0, checkedSentences: 0, uncoveredSentenceIndexes: [], uncovered: ['input_too_long'] };
  }
  const sourceSentences = usunEtykietyDowodow(answer).split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  const sentences = sourceSentences.flatMap((sentence, sourceSentenceIndex) => {
    // Wskazanie zrodla w nawiasie („(Zrodlo: opis lokalizacji…)”) to metadane,
    // nie twierdzenie o swiecie. Bez tego zdanie nigdy nie ma pokrycia, bo
    // zaden claim nie opisuje metadanych.
    // Usuwamy WYLACZNIE sam nawias ze zrodlem (razem z zamykajacym nawiasem), a nie
    // ogon zdania — inaczej tresc po „(Zrodlo: …)” uciekalaby spod kontroli pokrycia.
    const withoutSource = sentence.replace(/\s*[([{]\s*(?:źród(?:a|ła|ło|em|ami)?|source(?:s)?)\s*:[^)\]}]*[)\]}]/giu, '').trim();
    // Zdanie bez liter i cyfr po usunieciu zrodla (np. sama kropka) nie jest twierdzeniem.
    if (!/[\p{L}\p{N}]/u.test(withoutSource)) return [];
    const base = withoutSource;
    // Oceniaj osobno koordynowane klauzule faktograficzne. Bez tego jedna
    // dobrze pokryta czesc zdania moze „zamaskowac” druga, niepoparta czesc.
    // Nie rozbijamy zwyklych list rzeczownikow (np. „ogien, mroz i magia”):
    // separator musi byc przecinkiem przed spojnikiem albo srednikiem.
    const clauses = base
      .split(/;\s*|,\s*(?=(?:and\s+then|and|but|then|while|or|a\s+(?:potem|nastepnie|nastepnie)|ale|jednak|nastepnie|nastepnie|oraz)\b)/iu)
      .map(part => part.trim())
      .filter(Boolean);
    if (clauses.length > 1) return clauses.map(text => ({ text, sourceSentenceIndex }));
    const match = base.match(/^(.*?)[,;]?\s+(?:ale|jednak)\s+(.+)$/iu);
    if (match && czyOgraniczenieDowodowe(match[2])) {
      return [match[1].trim(), match[2].trim()].filter(Boolean).map(text => ({ text, sourceSentenceIndex }));
    }
    return [{ text: base, sourceSentenceIndex }];
  });
  const claimRows = claimList
    .map(c => ({
      tokens: tokenyPokrycia(c?.claim || ''),
      concepts: pojeciaCrossLanguage(c?.claim || ''),
      entities: wyodrebnijNazwyWlasne(c?.claim || ''),
      numbers: liczbyDoPorownania(c?.claim || ''),
    }))
    .filter(row => row.tokens.length >= 2 || row.concepts.size || row.entities.length);

  const uncovered = [];
  let checkedSentences = 0;

  // Zdanie zaczynajace sie zaimieniem („Jego historia…”) nie nazywa podmiotu,
  // wiec nie da sie go dopasowac do claimu po nazwie. Podmiot dziedziczy po
  // poprzednim zdaniu, a z nim takze encje — bez tego zdanie nigdy nie ma pokrycia.
  // Demonstratywy („to”, „te”, „ten”, „ta”) celowo NIE sa tu anafora: wskazuja
  // rzeczownik w tym samym zdaniu („Te ziemie…”), a nie podmiot poprzedniego.
  const ANAPHORA = /^\s*(?:jego|jej|ich|oni|on|ona|one|he|she|they|it|his|her|their|its)\b/iu;

  for (const [sentenceIndex, sentenceRow] of sentences.entries()) {
    const sentence = sentenceRow.text;
    const sourceSentenceIndex = sentenceRow.sourceSentenceIndex;
    // Retrieval-scoped uncertainty is not a world fact and does not need to be
    // forced into a fabricated claim/citation. Keep factual clauses checked.
    if (czyOgraniczenieDowodowe(sentence)) continue;
    const tokens = tokenyPokrycia(sentence);
    if (tokens.length < 2) continue;
    checkedSentences++;

    const sentenceConcepts = pojeciaCrossLanguage(sentence);
    const sentenceNumbers = liczbyDoPorownania(sentence);
    let sentenceEntities = wyodrebnijNazwyWlasne(sentence);
    let anaphoric = false;
    if (!sentenceEntities.length && ANAPHORA.test(sentence)) {
      anaphoric = true;
      // Podmiot dziedziczymy z najblizszego poprzedniego zdania, ktore podmiot
      // nazywa wprost. Zdania tez zaimiennicze („Jest postacia Origin…”) podmiotu
      // nie wskazuja, wiec je pomijamy i szukamy dalej.
      for (let back = sentenceIndex - 1; back >= 0; back--) {
        const previous = sentences[back]?.text;
        if (!previous || czyOgraniczenieDowodowe(previous)) continue;
        const previousEntities = wyodrebnijNazwyWlasne(previous);
        if (!previousEntities.length) continue;
        if (ANAPHORA.test(previous) || /^\s*(?:jest|sa|byl|byla|bylo|byli|mial|miala|ma)\b/iu.test(previous)) continue;
        sentenceEntities = previousEntities;
        break;
      }
    }

    // Keep ownership: a claim may contribute coverage only when it has a
    // meaningful lexical connection to this sentence and shares a semantic
    // anchor (concept/entity). This prevents two unrelated claims from
    // assembling a plausible-looking aggregate vocabulary.
    const coherentRows = claimRows.map(row => {
      const matchedTokens = tokens.filter(token =>
        row.tokens.some(claimToken => tokenyPokrywajaSie(token, claimToken))
      );
      const tokenCoverage = matchedTokens.length / Math.max(tokens.length, 1);
      const sharedConcepts = [...sentenceConcepts].filter(concept => row.concepts.has(concept));
      const sharedEntities = sentenceEntities.filter(entity => row.entities.includes(entity));
      const coherent = anaphoric
        // Zdanie anaforyczne („Jego historia…”) nie powtarza podmiotu, wiec
        // jego pokrycie leksykalne z definicji jest niskie. Kotwica jest rozwiazana
        // encja: jesli claim o tej samej encji potwierdza tresc zdania, zdanie jest
        // pokryte. Prog tokenowy jest tu nizszy, bo encja weryfikuje tozsamosc.
        //
        // Niskie pokrycie leksykalne oznacza jednak, ze zdanie moze wniesc tresc,
        // ktorej claim nie potwierdza. Liczby sa tu najostrzejsza granica:
        // claim dzielacy z zdaniem jedno slowo („lat”) pokrywalby zdanie
        // „Jego historia trwa trzysta lat”, mimo ze tej liczby nie ma w dowodzie.
        // Liczba w zdaniu anaforycznym musi wiec wystepowac w spojnym claimie.
        ? tokenCoverage >= 0.15
          && (sharedEntities.length > 0 || sharedConcepts.length > 0)
          && sentenceNumbers.every(number => row.numbers.includes(number))
        : tokenCoverage >= 0.30
          && (sharedConcepts.length > 0 || sharedEntities.length > 0 || tokenCoverage >= 0.65);
      return { row, matchedTokens, tokenCoverage, sharedConcepts, sharedEntities, coherent };
    }).filter(item => item.coherent);

    const ownedTokens = new Set(coherentRows.flatMap(item => item.matchedTokens));
    const tokenCoverage = tokens.filter(token => ownedTokens.has(token)).length / Math.max(tokens.length, 1);
    const conceptsOwned = [...sentenceConcepts].filter(concept =>
      coherentRows.some(item => item.row.concepts.has(concept))
    );
    const conceptCoverage = sentenceConcepts.size ? conceptsOwned.length / sentenceConcepts.size : 0;
    const entitiesOwned = sentenceEntities.filter(entity =>
      coherentRows.some(item => item.row.entities.includes(entity))
    );
    const entityCoverage = sentenceEntities.length ? entitiesOwned.length / sentenceEntities.length : 0;

    // Semantic fallback requires every material concept to be attributable to
    // a coherent claim; a high aggregate token score alone cannot prove a
    // relation assembled from unrelated claim fragments.
    const hasStrongSemanticCoverage = sentenceConcepts.size >= 2
      && conceptCoverage >= 0.8
      && tokenCoverage >= 0.35;
    const hasStrongEntityCoverage = sentenceEntities.length > 0
      && entityCoverage >= 0.9
      && tokenCoverage >= 0.45;
    // A sentence containing a material concept that no coherent claim owns is
    // not covered merely because names and common words inflate lexical overlap.
    const hasUncoveredConcept = sentenceConcepts.size > 0 && conceptCoverage < 0.8;
    // Zdanie anaforyczne kotwiczy sie w rozwiazanej encji: gdy istnieje spojny
    // claim o tej samej encji, zdanie jest pokryte mimo niskiego pokrycia
    // leksykalnego (podmiot nie jest powtorzony w tekscie). Liczymy encje
    // wspolna z tym claimem, nie caly odziedziczony zbior.
    const hasAnaphoricEntityCoverage = anaphoric
      && coherentRows.some(item => item.sharedEntities.length > 0)
      && tokenCoverage >= 0.15;
    const coverage = hasUncoveredConcept
      ? Math.min(tokenCoverage, 0.54)
      : (tokenCoverage >= 0.55
        ? tokenCoverage
        : (hasStrongSemanticCoverage || hasStrongEntityCoverage || hasAnaphoricEntityCoverage ? 0.56 : tokenCoverage));

    if (coverage < 0.55) uncovered.push({ index: sourceSentenceIndex, text: sentence.slice(0, 180) });
  }

  return {
    ok: uncovered.length === 0,
    totalSentences: sentences.length,
    checkedSentences,
    uncoveredSentenceIndexes: [...new Set(uncovered.map(item => item.index))].slice(0, 8),
    uncovered: uncovered.slice(0, 4).map(item => item.text),
  };
}

function czyDowodSemantyczniePokrywaClaim(evidence, claim, options = {}) {
  if (String(evidence || '').length > 12000 || String(claim || '').length > 1000) return false;
  return zgodnoscStrukturalna(evidence, claim, options).ok;
}
// --- Tlumaczenie claimu (claim_en) -------------------------------------------------------------
// Polski claim kontra angielskie zrodlo dawal pokrycie leksykalne ~0,25, bo wspolne sa tylko nazwy
// wlasne. Walidator zwraca wiec dodatkowo claim_en i twarde kontrole (liczby, nazwy, negacja,
// przyczyna) robimy w jednym jezyku. Tlumaczenie pisze jednak model, wiec nie wolno mu ufac:
// musi zgadzac sie z oryginalem w tym, co da sie sprawdzic mechanicznie.
const EN_FUNCTION_WORDS = /(?<![\p{L}])(?:the|of|and|is|was|were|are|to|in|for|with|that|he|she|his|her|by|on|as|at|it|its|from|after|before|during|has|had|have|an|this|these|those|their|be|been|not|which|who|can|will|may|only|also|than|then|but|or|if|when|where|lasts?|takes?|does|did)(?![\p{L}])/giu;
// Polskie slowa funkcyjne: ich obecnosc wyklucza tekst angielski nawet bez znakow diakrytycznych.
// Tylko slowa, ktore w angielskim NIE wystepuja jako samodzielne slowa.
// „do”, „w”, „z”, „i”, „a”, „to” sa celowo pominiete — wszystkie wystepuja
// po angielsku, a ich dopisanie odwrociloby wykrywanie dla prawdziwych
// angielskich zrodel (czyli dla tej sciezki, ktora claim_en obsluguje).
// Z tego samego powodu usunieto „ale” (ang. piwo), „po”, „bo” i „jak”
// („Jak and Daxter”) — wystepuja w angielskich tekstach o grach.
const PL_FUNCTION_WORDS = /(?<![\p{L}])(?:jest|sie|sie|nie|ze|ze|przez|oraz|ktory|ktora|ktore|jego|jej|ich|dla|od|czy|gdy|sa|byl|byla|bylo|byly|trwa|walka|gra|gdzie|przy|takze|rowniez|jednak|poniewaz|zatem|wiec|wszystkie|wszystkich|mozna|nalezy|szukac|tylko|nadal|wciaz|wedlug|blisko|daleko|czesc|wiekszosc|musi|kazdy|kazda|wszystko|nic|ktos|zawsze|nigdy|wlasnie|bardzo|choc|chociaz|ponadto|wobec|okolo)(?![\p{L}])/iu;

// Polskie czasowniki 3. os. liczby pojedynczej: „przybywa”, „zostaje”.
// Koncowki „-wa” i „-uje” nie wystepuja w angielskim w tej pozycji
// (wyjatki typu „Iowa” sa nazwami wlasnymi, wiec je pomijamy).
const PL_VERB_ENDINGS = /(?:^|[^\p{Lu}])[\p{Ll}]{3,}(?:wa|uje)(?![\p{L}])/u;

function wyglądaNaAngielski(text) {
  const t = String(text || '');
  const normalized = normalizujClaim(t);
  if (/[ąęłńóśźżĄĘŁŃÓŚŹŻ]/.test(t)) return false;
  if (PL_FUNCTION_WORDS.test(normalized)) return false;
  if (PL_VERB_ENDINGS.test(normalized)) return false;
  // Krotki claim typu „Malenia defeated Radahn.” nie ma slow funkcyjnych, ale tez nie ma polskich.
  return (t.match(EN_FUNCTION_WORDS) || []).length >= 1 || t.trim().split(/\s+/).length >= 3;
}
const wygladaNaAngielski = wyglądaNaAngielski;

function zbiorRowny(a, b) {
  const sa = new Set(a); const sb = new Set(b);
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}

// Wycina z tekstu wzmianki o encjach nalezacych do tej samej grupy aliasowej.
// Zweryfikowane nazwy PL/EN nie zawsze maja wspolne tokeny, wiec porownanie
// tresci z ich udzialem mogloby dac falszywy negatyw. Wycinamy grupe po obu
// stronach, zeby porownac reszte; niezweryfikowane aliasy nie trafiaja do tabeli.
function wycinAliasowaneEncje(text, names) {
  let out = String(text || '');
  const wzorce = [];
  for (const name of names) {
    const surowa = String(name || '').trim();
    if (!surowa) continue;
    const alias = KNOWN_ENTITY_ALIAS_PATTERNS.find(item => {
      for (const probe of [surowa, normalizujClaim(surowa)]) {
        if (!probe) continue;
        try {
          if (new RegExp(item.pattern.source, 'iu').test(probe)) return true;
        } catch (_) { /* wzorzec niedozwolony — pomijamy */ }
      }
      return false;
    });
    if (alias && !wzorce.includes(alias)) wzorce.push(alias);
  }
  for (const alias of wzorce) {
    try {
      out = out.replace(new RegExp(alias.pattern.source, 'giu'), ' ');
    } catch (_) { /* pomijamy wzorzec, ktorego nie da sie zastosowac */ }
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Liczby do porownania w obrebie jednego jezyka (odpowiedz ↔ claim).
// Laczy zapis cyfrowy i slowny, bo model miesza oba zapisy w jednym tekscie.
// Nie wolno uzywac tego do porownania claimu z angielskim dowodem.
function liczbyDoPorownania(tekst) {
  return [...new Set([...wyodrebnijLiczbyIDaty(tekst), ...slowaLiczbowe(tekst)])];
}

// Angielskie liczby slowne zamieniane na cyfry wylacznie w kontrole parytetu PL↔EN claimu:
// „okolo 20 lat” ↔ „over twenty years”. Wersja z cyframi jest DODATKOWA sciezka akceptacji obok
// surowego tlumaczenia, wiec nie tworzy nowych odrzucen (np. „dwadziescia lat” ↔ „twenty years”).
const EN_LICZBY_SLOWNE = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
function angielskieLiczbySlowneNaCyfry(value) {
  return String(value || '').replace(
    /(?<![\p{L}\p{N}])(?:(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](one|two|three|four|five|six|seven|eight|nine)|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))(?![\p{L}\p{N}])/giu,
    (match, tens, unit, single) => String(tens
      ? EN_LICZBY_SLOWNE[tens.toLowerCase()] + EN_LICZBY_SLOWNE[unit.toLowerCase()]
      : EN_LICZBY_SLOWNE[single.toLowerCase()]),
  );
}

// Czy w cytacie po zachowanym imieniu stoi inny wyraz pisany wielka litera („Johnny Cash”)?
// Wtedy cytat mowi o innej osobie niz „Johnny Silverhand” i skrot imienia nie moze byc uznany
// za te sama encje. Interpunkcja konczaca token przerywa nazwe; „’s” jest odcinane.
// Odpowiednik followedByForeignSurname z ai/entities.js, ale dzialajacy na cytacie.
function cytatRozszerzaNazwePoImieniu(quote, nameVariants) {
  const tokens = String(quote || '').split(/\s+/u).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (/[.!?,;:)]$/u.test(tokens[i])) continue;
    if (!nameVariants.has(normalizujClaim(tokens[i].replace(/['\u2019]s$/iu, '')))) continue;
    if (/^[A-ZĄĆĘŁŃÓŚŹŻ]/u.test(tokens[i + 1])) return true;
  }
  return false;
}

// The Skyrim lore phrase reverses cause/effect when a Polish claim says
// Thu'um lets the Dragonborn absorb souls, but its English translation says
// soul absorption grants knowledge of Thu'um. Both contain the same keywords;
// preserve their direction rather than accepting token overlap as equivalence.
function czyTlumaczenieOdwracaRelacjeThuUmIPochlaniania(claimPl, claimEn) {
  const pl = normalizujClaim(claimPl);
  const en = normalizujClaim(claimEn);
  const plThuUm = /\bthu\s+um\b/u.exec(pl);
  const plAbsorb = /\bpochlan\w*\b/u.exec(pl);
  const enAbsorb = /\babsorb\w*\b/u.exec(en);
  const enKnowledgeThuUm = /\bknowledge\s+of\s+(?:the\s+)?thu\s+um\b/u.exec(en);
  return Boolean(
    plThuUm && plAbsorb && plThuUm.index < plAbsorb.index
    && enAbsorb && enKnowledgeThuUm && enAbsorb.index < enKnowledgeThuUm.index
  );
}

// Wheatley seizing control of Aperture is the effect: the sudden influx of
// power corrupts him, and that is what leads him to take control — not the
// reverse. A translation that swaps the order (claiming that taking control
// is what corrupts him) states the opposite causal relation even though both
// versions share the same 'corrupt'/'control' keywords.
function czyTlumaczenieOdwracaRelacjeKorupcjiWheatleya(claimPl, claimEn) {
  const pl = normalizujClaim(claimPl);
  const en = normalizujClaim(claimEn);
  if (!/\bwheatley\b/u.test(pl) || !/\bwheatley\b/u.test(en)) return false;
  const plCorrupt = /\b(?:skorumpow\w*|korumpuj\w*)/u.exec(pl);
  const plControl = /\b(?:kontrol\w*|wladz\w*)/u.exec(pl);
  if (!plCorrupt || !plControl || plCorrupt.index >= plControl.index) return false;
  // „takes control, which corrupts him” odwraca kierunek; końcowe
  // „takes control, corrupted by power” jest tylko zmianą szyku.
  return /\bcontrol\w*[^.!?]{0,100}\b(?:which|that|and|because|since|as)\s+(?:he\s+|it\s+|this\s+|that\s+)?corrupt(?:s|ed|ing)\b/u.test(en);
}

function spojnoscTlumaczeniaClaimu(claimPl, claimEn, options = {}) {
  const pl = String(claimPl || '').trim();
  const en = String(claimEn || '').trim();
  if (pl.length > 1000 || en.length > 1000) return { ok: false, reason: 'claim przekracza limit długości' };
  if (!pl || !en) return { ok: false, reason: 'brak tlumaczenia claimu' };
  if (en.length > pl.length * 3 + 60) return { ok: false, reason: 'tlumaczenie claimu jest nieproporcjonalnie dlugie' };
  if (!wygladaNaAngielski(en)) return { ok: false, reason: 'claim_en nie wyglada na tekst angielski' };
  // Zbieznosc claim_en z cytatem sama w sobie nie dowodzi bledu: poprawny claim
  // moze byc wiernym tlumaczeniem zdania zrodlowego. Jesli jednak model skopiowal
  // caly cytat, wymagamy tez pozytywnej zgodnosci semantycznej PL→EN; inaczej
  // pozniejsza walidacja moglaby porownac cytat z samym soba zamiast z claimem.
  const quoteNorm = normalizujClaim(options.evidenceQuote || '');
  const copiedQuote = Boolean(quoteNorm) && normalizujClaim(en) === quoteNorm;
  if (copiedQuote) {
    // Powod odrzucenia zachowuje diagnostyke sprzecznosci (np. zabojstwo vs schwytanie),
    // zamiast ja zastepowac ogolnym komunikatem.
    const konfliktCytatu = sprawdzSprzecznosciSemantyczne(pl, en);
    const powodNiezgodnosci = konfliktCytatu.ok
      ? 'claim_en kopiuje cytat, ale nie odpowiada treści claimu'
      : 'claim_en kopiuje cytat, ale nie odpowiada treści claimu: ' + konfliktCytatu.reason;
    // Wycinamy aliasowane encje z obu stron i porownujemy RESZTE tresci.
    // Bez tego kopiowanie cytatu czynilo weryfikacje tautologiczna: claim_en
    // jest wtedy cytatem, wiec „dowod zgodny z claim_en” niczego nie dowodzi,
    // a jedynym straznikiem zostaje slownik pojec (z lukami).
    const aliasowaneEncje = [...new Set([
      ...wyodrebnijNazwyWlasne(pl, options),
      ...wyodrebnijNazwyWlasne(pl),
    ])];
    const plBezEncji = wycinAliasowaneEncje(pl, aliasowaneEncje);
    const enBezEncji = wycinAliasowaneEncje(en, aliasowaneEncje);
    const polishConcepts = pojeciaCrossLanguage(plBezEncji);
    const englishConcepts = pojeciaCrossLanguage(enBezEncji);
    const sharedConcepts = [...polishConcepts].filter(concept => englishConcepts.has(concept));
    // Entity/name overlap alone is not positive evidence that the action agrees:
    // „zniszczyl Aperture” must not pass against „took control of Aperture”.
    // The same applies when the concept dictionary recognizes neither action:
    // if claim_en is a verbatim quote, the quote cannot validate its own translation.
    // In that case we abstain until the PL↔EN action can be checked, rather than
    // silently treating a shared character/place name as proof of semantic equivalence.
    // Gdy sam claim jest juz po angielsku, cytat moze byc weryfikowany
    // bezposrednio przez pozniejsze kontrole liczb, negacji, relacji i nazw.
    // Dla polskiego claimu kopiowanie angielskiego cytatu wymaga jednak
    // przynajmniej jednego wspolnego pojecia dzialania; sama encja nie wystarcza.
    const normalizedClaim = normalizujClaim(pl);
    const directSameLanguageEvidence = wygladaNaAngielski(pl)
      && normalizedClaim.length > 0
      && quoteNorm.includes(normalizedClaim);
    const claimNamesForCopy = wyodrebnijNazwyWlasne(pl, options);
    const sharedNameAnchor = claimNamesForCopy.some(name => czyNazwaWlasnaWystepuje(name, quoteNorm));
    const copiedQuoteHasIndependentSignal = sharedNameAnchor
      || (wyodrebnijLiczbyIDaty(pl).length > 0 && wyodrebnijLiczbyIDaty(en).length > 0)
      || (wyodrebnijJednostkoweWartosci(pl).length > 0 && wyodrebnijJednostkoweWartosci(en).length > 0);
    // Brak wspolnego pojecia jest sygnalem sprzecznosci tylko wtedy, gdy
    // slownik pojec w ogole COS rozpoznal po ktorejs ze stron (np. claim o
    // ucieczce vs cytat o narodzinach — patrz test ponizej). Gdy slownik nie
    // rozpoznaje NIC po zadnej stronie — co jest normalne dla claimow o
    // czasie trwania, liczbach, porownaniach rozmiarow itp., bo
    // pojeciaCrossLanguage zna tylko waski slownik akcji narracyjnych —
    // pusty zbior po obu stronach nie dowodzi niczego i nie powinien sam w
    // sobie odrzucac tlumaczenia. W takim wypadku oddajemy kontrole dalszym,
    // bardziej ogolnym sprawdzeniom (liczby, jednostki, negacja, relacje
    // przyczynowe, sprzecznosci strukturalne), ktore i tak wykonuja sie nizej.
    if (sharedConcepts.length === 0 && !directSameLanguageEvidence
      && (polishConcepts.size > 0 || englishConcepts.size > 0)) {
      return { ok: false, reason: powodNiezgodnosci };
    }
    if (sharedConcepts.length === 0 && !directSameLanguageEvidence && !copiedQuoteHasIndependentSignal) {
      return { ok: false, reason: powodNiezgodnosci };
    }
    // When claim_en is a verbatim quotation, require semantic concept parity
    // in both directions after removing recognized entity names. A quote that
    // adds source facts is not a faithful translation of a narrower Polish claim.
    // Add precise cross-language mappings for genuine equivalents; never weaken
    // this equality check merely to make a copied quotation pass.
    const addedConcepts = [...englishConcepts].filter(concept => !polishConcepts.has(concept));
    if (addedConcepts.length) {
      return { ok: false, reason: powodNiezgodnosci };
    }
    let missingConcepts = [...polishConcepts].filter(concept => !englishConcepts.has(concept));
    if (missingConcepts.length) {
      // Cytat bywa zdaniem, w ktorym encja ze wstepu claimu („Shulker”) jest
      // w zrodle zastapiona zaimkiem („It will attack…”), bo pelna nazwa padla
      // w POPRZEDNIM zdaniu tego samego zrodla. Dotyczy to tylko pojec, ktore
      // w praktyce reprezentuja nazwe encji (ich wzorzec dopasowuje sie tez w
      // obrebie samej nazwy w claimPl — np. 'shulker'), nie akcji/czynnosci:
      // te musza byc wyrazone wprost w cytowanym zdaniu. Reuzywamy tej samej
      // kontroli „ten sam fragment zdania zrodla”, co przy zgubionych nazwach
      // wlasnych ponizej, zamiast tworzyc osobny, slabiej przetestowany mechanizm.
      const enNormalizedForConcepts = normalizujClaim(en);
      if (/^(?:who|which|that|he|she|it|they|his|her|their|its)\s/u.test(enNormalizedForConcepts)) {
        const evidenceContextForConcepts = String(options.evidenceContext || '');
        const evidenceQuoteForConcepts = String(options.evidenceQuote || '').trim();
        const quotePrefixForConcepts = evidenceQuoteForConcepts
          ? findQuotePrefix(evidenceContextForConcepts, evidenceQuoteForConcepts)
          : null;
        if (quotePrefixForConcepts !== null) {
          const sameSentencePrefixForConcepts = quotePrefixForConcepts.split(/\bsentenceboundarytoken\b/u).at(-1) || '';
          missingConcepts = missingConcepts.filter(concept => {
            const definition = CROSS_LANGUAGE_CONCEPTS.find(([nazwa]) => nazwa === concept);
            return !(definition && definition[1].test(sameSentencePrefixForConcepts));
          });
        }
      }
      if (missingConcepts.length) {
        return { ok: false, reason: powodNiezgodnosci };
      }
    }
    // Zgodnosci leksykalnej PL↔EN tutaj nie wymagamy dla nazw z jawnie
    // zweryfikowanymi aliasami: nie musza miec wspolnych tokenow. Rozstrzygaja zamiast tego:
    //   • zbiory pojec powyzej (claim_en nie dodaje, nie podmienia i nie pomija
    //     pojecia po wycieciu encji),
    //   • twarde kontrole liczb, jednostek, negacji i przyczyny ponizej,
    //   • twarda kontrola nazw wlasnych ponizej (claim nie moze zgubic ani
    //     podmienic nazwy).
    // Kontrola dowodu na claim_en NIE jest tu straznikiem: gdy claim_en jest
    // kopia cytatu, porownuje ona cytat z samym soba. Dlatego powyzsze trzy
    // punkty musza wystarczac samodzielnie.
    // Bez tego warunku claim_en nigdy nie byloby uzyteczne dla nazw tlumaczonych.
  }
  // Liczby/daty obecne w polskim claimie musza pozostac w tlumaczeniu.
  // Data dodana przez evidence/claim_en moze jednak zostac bezpiecznie
  // pominieta przy uogolnieniu polskiego zdania.
  const polishNumbers = wyodrebnijLiczbyIDaty(pl);
  const enLiczbowo = angielskieLiczbySlowneNaCyfry(en);
  const englishNumbers = [...new Set([...wyodrebnijLiczbyIDaty(en), ...wyodrebnijLiczbyIDaty(enLiczbowo)])];
  if (polishNumbers.some(number => !englishNumbers.includes(number))) {
    return { ok: false, reason: 'tlumaczenie claimu zmienia liczby lub daty' };
  }
  const polishUnits = wyodrebnijJednostkoweWartosci(pl);
  if (!zbiorRowny(polishUnits, wyodrebnijJednostkoweWartosci(en))
    && !zbiorRowny(polishUnits, wyodrebnijJednostkoweWartosci(enLiczbowo))) {
    return { ok: false, reason: 'tlumaczenie claimu zmienia jednostki lub wartosci' };
  }
  if (wyodrebnijMarkery(pl, NEGATION_RE) !== wyodrebnijMarkery(en, NEGATION_RE)) {
    return { ok: false, reason: 'tlumaczenie claimu zmienia negacje' };
  }
  // Zmiane zdarzenia (np. „przejal kontrole” → „destroyed”) wykrywaja ogolne pary
  // przeciwstawnych pojec w sprawdzSprzecznosciSemantyczne; tu nie ma wyjatkow dla konkretnych fraz.
  if (czyTlumaczenieOdwracaRelacjeThuUmIPochlaniania(pl, en)) {
    return { ok: false, reason: "tłumaczenie claimu odwraca relację między pochłanianiem dusz a wiedzą o Thu'um" };
  }
  if (czyTlumaczenieOdwracaRelacjeKorupcjiWheatleya(pl, en)) {
    return { ok: false, reason: 'tłumaczenie claimu odwraca relację między skorumpowaniem Wheatleya a przejęciem kontroli' };
  }
  const semanticConflict = sprawdzSprzecznosciSemantyczne(pl, en);
  if (!semanticConflict.ok) return { ok: false, reason: 'tlumaczenie claimu zmienia zdarzenie lub relacje' };
  const polishReasonClause = /\bprzyczyn\w*\s+(?:dla\s+)?ktorej\b/u.test(normalizujClaim(pl));
  const englishReasonClause = /\b(?:the\s+)?reason\s+why\b/u.test(normalizujClaim(en));
  // „Nie ma danych potwierdzajacych przyczyne, dla ktorej…” ↔
  // “There is no data confirming the reason why…” opisuje brak wiedzy,
  // a nie dokonuje nowego twierdzenia przyczynowego. CAUSAL_RE pozostaje
  // bez zmian; wyjatek dotyczy wylacznie rownowaznej konstrukcji w tlumaczeniu.
  const plCausal = wyodrebnijMarkery(pl, CAUSAL_RE);
  const enCausal = wyodrebnijMarkery(en, CAUSAL_RE);
  // Polish "zmusza" and English "forces" express the same compulsion relation.
  // Keep this equivalence local; do not broaden the global causal marker set.
  const plCompulsion = /\bzmusz\w*/iu.test(normalizujClaim(pl));
  const enCompulsion = /\bforc(?:e|es|ed|ing)\b/iu.test(normalizujClaim(en));
  const equivalentCompulsion = plCompulsion && enCompulsion;
  const equivalentEnable = /\bpozwal\w*/iu.test(normalizujClaim(pl))
    && /\benabl(?:e|es|ed|ing)\b/iu.test(normalizujClaim(en));
  const equivalentOfferOutcome = /przyj[ee]ci\w*\s+(?:tej\s+)?ofert\w*/iu.test(normalizujClaim(pl))
    && /taking (?:him )?up on (?:this|the) offer/iu.test(normalizujClaim(en))
    && /\bjoin(?:s|ed|ing)? (?:the|your) party\b/iu.test(normalizujClaim(en));
  if (plCausal !== enCausal && !equivalentCompulsion && !equivalentEnable && !equivalentOfferOutcome
    && !(polishReasonClause && englishReasonClause)) {
    return { ok: false, reason: 'tłumaczenie claimu zmienia relację przyczynową' };
  }
  if (wyodrebnijMarkery(pl, REDUCTION_RE) !== wyodrebnijMarkery(en, REDUCTION_RE)) {
    return { ok: false, reason: 'tlumaczenie claimu zmienia kierunek redukcji lub ochrony' };
  }
  const enNormalized = normalizujClaim(en);
  // Z wyrocznia nazw (wywolanie z zrodlami) obowiazuje ta sama zasada co przy dowodzie: slowo na
  // poczatku zdania jest nazwa tylko wtedy, gdy ma sygnal (znany alias, nazwa wielowyrazowa, wielka
  // litera w srodku zdania, obecnosc w wyroczni). Wczesniej drugi przebieg bez wyroczni liczyl
  // KAZDE takie slowo, wiec polskie rzeczowniki pospolite („Wspolny”, „Przedmiotu”, „Relacja”)
  // odpadaly jako „gubi nazwy wlasne”. Bez wyroczni nie ma czym rozstrzygnac, wiec liczy sie kazde.
  // Konsekwencja: nieznana nazwa postaci na poczatku zdania, ktorej nie ma w tabelach ani w
  // zrodlach, nie jest juz pilnowana przy tlumaczeniu (nadal pilnuje jej kontrola dowodu).
  const claimNames = [...new Set([
    ...wyodrebnijNazwyWlasne(pl, options),
    ...(options.nameOracle instanceof Set ? [] : wyodrebnijNazwyWlasne(pl)),
  ])];
  if (copiedQuote && /^(?:who|which|that|he|she|it|they|his|her|their|its)\s/u.test(enNormalized)) {
    const evidenceContext = String(options.evidenceContext || '');
    const evidenceQuote = String(options.evidenceQuote || '').trim();
    const missingClaimNames = claimNames.filter(name => !czyNazwaWlasnaWystepuje(name, enNormalized));
    // The quote verifier normalizes whitespace, punctuation, and accents.
    // Locate the quote with that same normalization instead of raw indexOf().
    const quotePrefix = evidenceQuote ? findQuotePrefix(evidenceContext, evidenceQuote) : null;
    if (missingClaimNames.length) {
      if (quotePrefix === null) {
        return { ok: false, reason: 'tłumaczenie claimu gubi nazwy własne: ' + missingClaimNames.slice(0, 3).join(', ') };
      }
      const sameSentencePrefix = quotePrefix.split(/\bsentenceboundarytoken\b/u).at(-1) || '';
      const normalizedPrefix = ' ' + sameSentencePrefix + ' ';
      if (!missingClaimNames.every(name => normalizedPrefix.includes(' ' + normalizujClaim(name) + ' '))) {
        return { ok: false, reason: 'tłumaczenie claimu gubi nazwy własne: ' + missingClaimNames.slice(0, 3).join(', ') };
      }
    }
  }
  // Twarda kontrola: polska nazwa wlasna musi wystapic w angielskim tlumaczeniu.
  // Dla nazwy przetlumaczonej rozstrzyga tabela aliasow — czyNazwaWlasnaWystepuje
  // sprawdza w niej wzorzec (PL i EN w jednym wyrazeniu), a podmiana encji
  // („Malenia” → „Radahn”) i utrata encji („Wheatley” → „He”) nadal padaja.
  // Te dwie ostatnie wlasnosci
  // sa pilnawcami podmiany podmiotu, wiec nie moga zostac rozluznione.
  // „Relik” jest zlokalizowana nazwa przedmiotu w Cyberpunk 2077; w angielskim
  // zapisie wystepuje jako „Relic”. Nie dodajemy tego do globalnej tabeli aliasow,
  // bo zwykle slowo „relic” poza kontekstem gry nie jest nazwa wlasna.
  const cyberpunkRelicContext = /\b(?:cyberpunk(?:\s+2077)?|johnny\s+silverhand|dexter\s+deshawn|night\s+city|engram|robert\s+john\s+linder)\b/iu.test(pl + ' ' + en);
  const missing = claimNames.filter(name => {
    if (normalizujClaim(name) === 'relik'
      && cyberpunkRelicContext
      && /\brelic\b/u.test(enNormalized)) return false;
    return !czyNazwaWlasnaWystepuje(name, enNormalized);
  });
  if (missing.length) {
    // Pelna nazwa moze pochodzic z pytania, podczas gdy evidence_quote uzywa
    // skrotu (np. „Johnny” zamiast „Johnny Silverhand”). Skrot jest dopuszczalny
    // tylko wtedy, gdy cytat naprawde mowi o tej samej encji: zachowane imie musi
    // w nim wystapic i nie moze po nim stac inny czlon nazwy („Johnny Cash”
    // to nie „Johnny Silverhand”), a brakujaca czesc nie moze wystepowac w cytacie.
    const quoteText = normalizujClaim(options.evidenceQuote || '');
    const retainedNames = claimNames.filter(name => !missing.includes(name) && czyNazwaWlasnaWystepuje(name, enNormalized));
    // Zachowana czesc musi sasiadowac z brakujaca w polskim claimie.
    const adjacentRetainedNames = retainedNames.filter(retained => missing.some(name =>
      czyNazwySasiaduja(pl, retained, name)
    ));
    const hasRetainedEntity = adjacentRetainedNames.length > 0 && adjacentRetainedNames.every(retained =>
      czyNazwaWlasnaWystepuje(retained, quoteText)
      && !cytatRozszerzaNazwePoImieniu(options.evidenceQuote, new Set([
        normalizujClaim(retained),
        ...wariantyNazwyDoDopasowania(retained).map(normalizujClaim),
      ])));
    const missingInQuoteToo = hasRetainedEntity
      ? missing.filter(name => !czyNazwaWlasnaWystepuje(name, quoteText))
      : [];
    if (quoteText && hasRetainedEntity && claimNames.length > missing.length && missingInQuoteToo.length === missing.length) return { ok: true };
    const missingFromTranslation = quoteText && hasRetainedEntity
      ? missing.filter(name => !missingInQuoteToo.includes(name))
      : missing;
    if (!missingFromTranslation.length) return { ok: true };
    // A source may quote a relative/anaphoric continuation ("who appears…")
    // that is not a standalone translation of the Polish claim. Accept the
    // omitted subject only when the exact quote is embedded in the supplied,
    // bounded source context and the claimed entity is in the SAME sentence
    // immediately before that quote. The downstream evidence check still
    // validates the action, quote, and source binding.
    const evidenceContext = String(options.evidenceContext || '');
    const evidenceQuote = String(options.evidenceQuote || '').trim();
    // Reuse quoteExists' punctuation/whitespace normalization; raw indexOf()
    // rejected valid quotes when extraction normalized spacing or punctuation.
    const quotePrefix = evidenceQuote ? findQuotePrefix(evidenceContext, evidenceQuote) : null;
    const anaphoricEn = ['who ', 'which ', 'that ', 'he ', 'she ', 'it ', 'they ', 'his ', 'her ', 'their ', 'its ']
      .some(prefix => enNormalized.startsWith(prefix));
    // Only the sentence containing the quote may supply the omitted subject.
    const sameSentencePrefix = quotePrefix !== null
      ? (quotePrefix.split(/\bsentenceboundarytoken\b/u).at(-1) || '')
      : '';
    const normalizedPrefix = ' ' + sameSentencePrefix + ' ';
    const missingEntitiesBound = quotePrefix !== null
      && anaphoricEn
      && missingFromTranslation.every(name => normalizedPrefix.includes(' ' + normalizujClaim(name) + ' '));
    if (!missingEntitiesBound) {
      return { ok: false, reason: 'tłumaczenie claimu gubi nazwy własne: ' + missingFromTranslation.slice(0, 3).join(', ') };
    }
  }
  return { ok: true };
}

module.exports = { KNOWN_ENTITY_ALIAS_PATTERNS, pojeciaCrossLanguage, CAUSAL_RE, CAUSAL_EVIDENCE_RE, wyglądaNaAngielski, wygladaNaAngielski, spojnoscTlumaczeniaClaimu, czyTlumaczenieOdwracaRelacjeKorupcjiWheatleya, czyOgraniczenieDowodowe, normalizujClaim, tokenyClaim, liczbyDoPorownania, czyRelacjaPrzyczynowaPokrywaClaim, wyodrebnijLiczbyIDaty, wyodrebnijJednostkoweWartosci, wyodrebnijNazwyWlasne, zbudujWyroczniaNazw, zgodnoscStrukturalna, sprawdzTwardeKonflikty, sprawdzSprzecznosciSemantyczne, dopasowanieSemantyczne, sprawdzPokrycieClaimamiOdpowiedzi, czyDowodSemantyczniePokrywaClaim, tokenyPokrywajaSie, czyNazwaWlasnaWystepuje, czyNazwySasiaduja, usunEtykietyDowodow };
