'use strict';

const { ENTITY_ALIAS_GROUPS, buildEntityAliasPatterns } = require('./entityAliases');
const { slowaLiczbowe } = require('./polishNumbers');
const { GAME_ALIASES } = require('./entities');

const NEGATION_RE = /(?<![\p{L}])(?:nie|nigdy|brak|bez|zaden|zadna|zadne|never|no|not|cannot|without|lack\s+of|absence\s+of|unable|neither|nor|fails?\s+to|\p{L}+n['’]t)(?![\p{L}])/iu;
// Ta sama lista bez gołego „no”: „no damage” to kwantyfikator zerowy, a nie zaprzeczenie czasownika.
const NEGATION_STRICT_RE = /(?<![\p{L}])(?:nie|nigdy|brak|bez|zaden|zadna|zadne|never|not|cannot|without|lack\s+of|absence\s+of|unable|neither|nor|fails?\s+to|\p{L}+n['’]t)(?![\p{L}])/iu;
// Claim o redukcji/ograniczeniu jest zgodny z dowodem „no damage / take no damage” (zero implikuje zmniejszenie).
// „s?tlumi\w*” obejmuje odmiany „tłumić” (tłumiąca, tłumienie, stłumić), ale nie „tłumaczy”/„tłum”.
const REDUCTION_RE = /(?<![\p{L}])(?:zmniejsz\w*|ogranicz\w*|redukuj\w*|zredukow\w*|oslab\w*|chron\w*|neutralizuj\w*|reduc\w*|inhibit\w*|dampen\w*|s?tlumi\w*|mitigat\w*|lower\w*|decreas\w*|protect\w*|prevent\w*|avoid\w*|block\w*|ward\w*|immun\w*|resist\w*|zapobieg\w*|unik\w*|blok\w*|odporn\w*)(?![\p{L}])/iu;
// „skutkuj\w*” i „w rezultacie” to polskie odpowiedniki „resulting in”/„as a result”: bez nich
// polski claim z relacją przyczynową przechodził kontrolę parytetu PL↔EN, gdy claim_en ją gubił.
const CAUSAL_RE = /(?<![\p{L}])(?:bo|poniewaz|gdyz|dlatego|because|therefore|caused|causes|trigger\w*|consequently|hence|as\s+a\s+result|led\s+to|leading\s+to|resulted\s+in|resulting\s+in|because\s+of|due\s+to|thereby|thus|w\s+ten\s+sposob|przez\s+co|co\s+(?:umozliw\w*|spowod\w*)|motyw\w*|zmusz\w*|powoduj\w*|przyczyn\w*|wskutek|w\s+efekcie|skutkuj\w*|w\s+rezultacie|allow(?:s|ed|ing)?|enabl(?:e|es|ed|ing)|which\s+(?:let|lets|allowed|allows|enabled|enables)|putting\s+(?:him|her|them|it)\s+in\s+control|giving\s+(?:him|her|them|it)\s+control|dajac\s+(?:mu|jej|im)\s+(?:wladz\w*|kontrol\w*|panowan\w*)|force(?:s|d|ing)?\s+(?:the\s+)?[\p{L}\p{N}'’_-]+(?:\s+[\p{L}\p{N}'’_-]+){0,1}\s+to\s+[\p{L}\p{N}'’_-]+|so\s+(?:he|she|they|it|we|the)|in\s+exchange(?:\s+for)?|in\s+return(?:\s+for)?|in\s+turn|thanks\s+to|owing\s+to|w\s+zamian(?:\s+za)?|w\s+rewan[zż]u|w\s+wyniku|z\s+powodu|dzieki|spowod\w*|doprowadz\w*|umozliw\w*)(?![\p{L}])/iu;
// Nie traktujemy samego „force” jako przyczynowości: „forced a core transfer”
// może opisywać akcję. Rozpoznajemy jednak konstrukcję „force X to Y” oraz
// bezpośrednie „giving him control”, które wyrażają relację między zdarzeniami.
// Purpose clauses („so that X could…”) nadal nie dowodzą, że skutek nastąpił.
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
  ['konflikt', /conflict\w*|feud\w*|fight\w*|war\w*|hatred|hate\w*|konflikt\w*|walcz\w*|wojn\w*/i],
  ['zwiazek', /relationship\w*|girlfriend\w*|boyfriend\w*|partner\w*|romanc\w*|romantic\w*|involved|zwi[aą]zk\w*|zwiaz\w*|relacj\w*|dziewczyn\w*|chlopak\w*/i],
  ['pomoc', /help\w*|assist\w*|save\w*|rescu\w*|pomog\w*|pomaga\w*|urat\w*|ocal\w*/i],
  // Granica słowa przed „appear”: „disappears” oznacza przeciwną akcję i nie może być uznane za „appears”.
  ['wystepowanie', /\b(?:appear\w*|pojaw\w*|wystep\w*)/i],
  ['kontrola', /control\w*|take[s]?\s+over|command\w*|manipulat\w*|kontrol\w*|przej[a]l\w*|manipul\w*|removed?\s+from\s+power|los[et]\s+control/i],
  // „bossem”, „bossa”, „bosses”: odmiana nie może zerwać zgodności pojęcia PL↔EN.
  ['szef', /\bboss\w*|szef\w*|leader\w*|przywodc\w*/i],
  ['porazka', /defeat\w*|beaten|overcome\w*|pokon\w*|pora[zż]k\w*/i],
  ['zdrada', /betray\w*|traitor\w*|zdradz\w*|zdrajc\w*/i],
  ['tworzenie', /creat\w*|develop\w*|build\w*|made\b|stworz\w*|tworz\w*|opracow\w*/i],
  ['destrukcja', /destroy\w*|destruct\w*|demolish\w*|ruin\w*|zniszcz\w*|zniszczen\w*|rozbij\w*/i],
  ['praca', /work\w*|employ\w*|job\w*|prac\w*|zatrud\w*/i],
  ['lokalizacja', /found|find\w*|locat\w*|location\w*|znalezc\w*|znajduj\w*|lokaliz\w*|lezy|polozen\w*/i],
  ['wydanie', /release\w*|launch\w*|publish\w*|premier\w*|wydan\w*|ukaz\w*|debiut\w*/i],
  ['podroz', /travel\w*|arriv\w*|visit\w*|reach\w*|journey\w*|get there|follow\w*\s+(?:the\s+)?(?:road|route|path)|head\w*\s+to|udaj\w*\s+si[eę]|dotrze\w*|dotrz\w*|pod[aą][żz]\w*|szlak\w*|odwiedz\w*|przybyw\w*/i],
  ['rodzina', /family|families|wife|daughter|son|missing\s+(?:wife|daughter|son|family)|rodzin\w*|zaginion\w*|zona|corka|syn\w*/i],
  ['wymiana_informacji', /in\s+exchange\s+for|in\s+return\s+for|exchange\w*|w\s+zamian\s+za|w\s+zamian\w*|wzajemn\w*/i],
  ['poscig', /chas\w*|pursu\w*|hunt(?:ed|ing|s)\b|flee\w*|escap\w*|uciek\w*|gonil\w*|scig\w*|ucieczk\w*/i],
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
  ['towarzysz', /\bcompanions?\b|recruit\w*|party member\w*|minion\w*|summon\w*|towarzysz\w*|zrekrut\w*|wezw\w*|przywol\w*/i],
  ['ataki_dystansowe', /\branged\b|\bbow\b|luk\w*|dystansow\w*/i],
  ['modyfikacja_zachowania', /\bbehav\w*|make her behave|intelligence dampening|tlumi\w*|zmusz\w*|zachow\w*|rdzen osobowosci|force(?:s|d|ing)?\s+(?:the\s+)?[\w'-]+(?:\s+[\w'-]+){0,1}\s+to\s+[\w'-]+/i],
  ['walka_konna', /horseback|mounted combat|on horseback|konskiego grzbietu|na koniu|z konia|walczac z konia/i],
  ['pozycja_zdystansu', /far back|high up|at range|dystans\w*|z daleka|na dystans/i],
  ['gigantyczne_zwierzeta', /giant (?:zombie[- ]?)?dogs?|gigantyczn\w*\s+(?:zombie\s+)?ps\w*|wielkie (?:zombie\s+)?psy/i],
  ['ochrona_miejsca', /guard\w*|strzez\w*|pilnow\w*/i],
  ['atak', /\b(?:attack\w*|atak\w*)\b/i],
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
  // Zwykłe rzeczowniki, czasowniki i określenia błędnie wyciągane jako nazwy,
  // gdy autor odpowiedzi zapisze je wielką literą w środku zdania.
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
  { canonical: "alduin's wall", pattern: /\b(?:alduin['’]?s|alduins)\s+wall\b/iu },
  { canonical: 'dragonrend', pattern: /\bdragonrend\b/iu },
  // Minecraft: „End”, „Endu” i „Endzie” oznaczają tę samą krainę.
  { canonical: 'the end', pattern: /\b(?:the\s+end|end(?:u|em|zie|a)?)\b/iu },
  { canonical: 'spellbreaker', pattern: /\b(?:spellbreaker|zaklinacz\s+spellbreaker|łamacz(?:a|owi|em|u)?\s+zakl(?:ę|e)ć)\b/iu },
  { canonical: 'extended relaxation center', pattern: /\b(?:extended\s+relaxation\s+center|centrum\s+(?:przedluzonego|rozszerzonego)\s+relaksu)\b/iu },
  { canonical: 'aperture laboratories', pattern: /\b(?:aperture\s+laboratories|laboratori(?:a|ach|ami|ow|ów)\s+aperture)\b/iu },
  // „facility of Aperture” to PARAFRAZA z jednego źródła benchmarku, nie nazwa —
  // założenie do potwierdzenia na szerszej próbie. „Aperture Labs” celowo usunięte:
  // zlewałoby się z osobnym wpisem „aperture laboratories” powyżej.
  { canonical: 'aperture science', pattern: /\b(?:aperture\s+science|facility\s+of\s+aperture)\b/iu },
  { canonical: 'bloody baron', pattern: /\b(?:bloody\s+baron|baron(?:a)?\s+krwaw(?:y|ego|ym)|krwaw(?:y|ego|emu)\s+baron(?:a|em|owi)?)\b/iu },
  { canonical: 'wild hunt', pattern: /\b(?:wild\s+hunt|dziki\s+gon|dzikiego\s+gonu|dzikim\s+gonem)\b/iu },
  { canonical: 'cathedral of dragon communion', pattern: /\b(?:cathedral\s+of\s+dragon\s+communion|katedr(?:a|y|ę|e|ze)\s+komunii\s+smoka)\b/iu },
];
// Aliasy z tabeli danych (ai/entityAliases.js) łączymy z legacy regexami.
// Nie pomijamy grupy tylko dlatego, że jej kanoniczna nazwa już istnieje:
// starszy regex może nie obsługiwać odmiany polskiej (np. „Krwawym Baronem”).
for (const entry of buildEntityAliasPatterns(ENTITY_ALIAS_GROUPS)) {
  const existing = KNOWN_ENTITY_ALIAS_PATTERNS.find(item => item.canonical === entry.canonical);
  if (!existing) {
    KNOWN_ENTITY_ALIAS_PATTERNS.push(entry);
    continue;
  }
  existing.pattern = new RegExp(`(?:${existing.pattern.source})|(?:${entry.pattern.source})`, 'iu');
}
function normalizujClaim(value) {
  return String(value || '')
    .replace(/\bdoesn['’]t\b/giu, 'does not')
    .replace(/\bisn['’]t\b/giu, 'is not')
    .replace(/\baren['’]t\b/giu, 'are not')
    .replace(/\bwasn['’]t\b/giu, 'was not')
    .replace(/\bweren['’]t\b/giu, 'were not')
    .replace(/\bdon['’]t\b/giu, 'do not')
    .replace(/\bdidn['’]t\b/giu, 'did not')
    .replace(/\bhaven['’]t\b/giu, 'have not')
    .replace(/\bhasn['’]t\b/giu, 'has not')
    .replace(/\bhadn['’]t\b/giu, 'had not')
    .replace(/\bwouldn['’]t\b/giu, 'would not')
    .replace(/\bshouldn['’]t\b/giu, 'should not')
    .replace(/\bcouldn['’]t\b/giu, 'could not')
    .replace(/\bmustn['’]t\b/giu, 'must not')
    .replace(/\bcan['’]t\b/giu, 'cannot')
    .replace(/\bwon['’]t\b/giu, 'will not')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenyClaim(value) {
  return [...new Set(normalizujClaim(value).split(' ').filter(t => t.length >= 4))];
}
// Tytuły gier z tabeli ai/entities.js. Claim często powtarza tytuł z pytania („W grze Baldur's Gate 3…”),
// choć cytat źródłowy mówi tylko o postaci. Taki tytuł opisuje kontekst pytania, a nie fakt do
// potwierdzenia w cytacie, więc (1) numerał z tytułu nie jest liczbą do potwierdzenia w dowodzie
// i (2) słowa tytułu nie są nazwami własnymi wymaganymi w dowodzie. Zgodność tytułu ze źródłem pilnuje
// filtr źródeł (sourceMatchesRequestContext); pozostałe nazwy własne nadal muszą wystąpić w dowodzie.
// Skróty krótsze niż 5 znaków (mc, bg3, tlou) są zbyt dwuznaczne i nie są zwalniane.
const TYTULY_GIER = (() => {
  const sep = '[^\\p{L}\\p{N}]+';
  const esc = token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seen = new Set();
  const out = [];
  for (const entry of GAME_ALIASES) {
    for (const alias of [entry.name, ...entry.aliases]) {
      const tokens = String(alias || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const key = tokens.join(' ').toLocaleLowerCase('pl-PL');
      if (!tokens.length || key.replace(/ /g, '').length < 5 || seen.has(key)) continue;
      seen.add(key);
      const last = tokens[tokens.length - 1];
      const hasEdition = tokens.length > 1 && /^\d{1,4}$/u.test(last);
      out.push({
        re: new RegExp(`(?<![\\p{L}\\p{N}])${tokens.map(esc).join(sep)}(?![\\p{L}\\p{N}])`, 'giu'),
        hasDigit: /\d/u.test(key),
        edition: hasEdition ? last : null,
        // Ta sama seria z innym numerem w dowodzie („Fallout 3” przy claimie o „Fallout 4”)
        // oznacza, że numerał jest realnym rozróżnikiem i nie wolno go zwalniać.
        sibling: hasEdition
          ? new RegExp(`(?<![\\p{L}\\p{N}])${tokens.slice(0, -1).map(esc).join(sep)}${sep}(\\d{1,4})(?![\\p{L}\\p{N}])`, 'giu')
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
    if (title.sibling && [...evidence.matchAll(title.sibling)].some(match => match[1] !== title.edition)) continue;
    out = out.replace(title.re, ' ');
  }
  return out;
}
function rzymskieNaArabskie(s) {
  // Konwertuje poprawną liczbę rzymską na arabską. Zwraca null gdy nie jest
  // to poprawna liczba rzymska (używane do odfiltrowania zwykłych słów jak „Ciri”,
  // „Mix”, „Liv”, „mi” itp., które składają się z liter rzymskich).
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
  const raw = String(value || '');
  // Rozróżnia separator tysięcy od dziesiętnego:
  // 50,000 / 50.000 / 50 000 => 50000, ale 2,5 / 2.50 => 2.5.
  // Nie zmieniamy tekstu źródłowego poza normalizacją samych tokenów liczbowych.
  let text = raw.toLocaleLowerCase('pl-PL')
    .replace(/(?<=\d)[\s\u00a0\u202f](?=\d{3}(?:\D|$))/gu, '')
    .replace(/(\d)[,.](\d{3})(?=\D|$)/gu, '$1$2')
    .replace(/,/g, '.');
  const decadeFacts = [];
  const addDecade = (century, decade) => decadeFacts.push(`decade:${century}${decade}`);
  // „late 1980s”, „early '90s” and Polish „pod koniec lat 80.” are
  // equivalent temporal facts. Remove the decade phrase before numeric
  // extraction so 80/90 cannot be compared as unrelated integers.
  text = text.replace(/\b(?:19|20)\d{2}\s*s\b/gu, (match) => {
    const year = Number(match.match(/(?:19|20)\d{2}/)?.[0]);
    if (Number.isFinite(year)) addDecade(Math.floor(year / 100), year % 100 - (year % 10));
    return ' ';
  });
  text = text.replace(/\b(?:lat(?:ach)?\s+['’]?|['’])(\d{2})\s*(?:s|tych)?\b|\b(\d{2})s\b/gu, (match, first, second) => {
    const shortYear = first || second;
    const n = Number(shortYear);
    if (n >= 10 && n <= 99) decadeFacts.push(`decade:${(n >= 50 ? 1900 : 2000) + n - (n % 10)}`);
    return ' ';
  });
  const matches = text.match(/\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?%?\b/g) || [];
  const canonical = matches.map(value => {
    const percent = value.endsWith('%');
    const numeric = Number(percent ? value.slice(0, -1) : value);
    if (!Number.isFinite(numeric)) return value;
    return `${String(numeric)}${percent ? '%' : ''}`;
  });
  // Dodajemy konwersję rzymskich cyfr (np. III → 3, IV → 4), oznaczających
  // numery części gier, żeby np. dowód „Baldur's Gate III” pokrywał claim
  // „Baldur's Gate 3”. Dopasowujemy WRAŻLIWIE NA WIELKOŚĆ LITER (bez flagi 'i'),
  // żeby pominąć zwykłe słowa, w których przypadkowo występują litery rzymskie
  // (np. „mix”, „id”, „civic”, „civil”, „Liv”, „mill”, „Mili”). Poprawne
  // rzymskie cyfry w tytułach gier są pisane wielkimi literami (III, IV, IX).
  // Only uppercase sequel numerals used in titles (II–XVI); never treat abbreviations
  // such as MC, CD, DC or MM as numeric facts.
  const romanMatches = [];
  // Only convert a numeral when it follows a title-like run of capitalized words.
  // This keeps GTA V / Final Fantasy X / Baldur's Gate III while avoiding
  // arbitrary Roman-looking tokens in prose or acronyms such as MC, CD, MM, MIX.
  const titleNumeralRe = /\b(?:[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*\s+){1,5}(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)\b/gu;
  for (const match of raw.matchAll(titleNumeralRe)) romanMatches.push(match[1]);
  for (const r of romanMatches) {
    const n = rzymskieNaArabskie(r);
    if (n !== null) canonical.push(String(n));
  }
  // Uwaga: liczby słowne („trzysta”, „dwadzieścia”) celowo NIE są tu dokładane.
  // To porównanie bywa międzyjęzykowe (polski claim wobec angielskiego
  // dowodu), a „dwie” po polsku to „two” po angielsku — różne słowa, ta sama
  // liczba. Porównanie słów pomijałoby wtedy poprawny claim. Liczby słowne
  // porównujemy tam, gdzie obie strony są w tym samym języku
  // (patrz liczbyDoPorownania).
  return [...new Set([...canonical, ...decadeFacts])];
}
const UNIT_ALIASES = new Map([
  ['h','hour'], ['hr','hour'], ['hrs','hour'], ['hour','hour'], ['hours','hour'], ['godzina','hour'], ['godziny','hour'], ['godzin','hour'], ['godz','hour'],
  ['min','minute'], ['mins','minute'], ['minute','minute'], ['minutes','minute'], ['minuta','minute'], ['minuty','minute'], ['minut','minute'],
  ['s','second'], ['sec','second'], ['second','second'], ['seconds','second'], ['sekunda','second'], ['sekundy','second'], ['sekund','second'],
  ['day','day'], ['days','day'], ['dzień','day'], ['dni','day'], ['dnia','day'],
  ['year','year'], ['years','year'], ['rok','year'], ['lata','year'], ['lat','year'],
  ['km','km'], ['kilometer','km'], ['kilometers','km'], ['kilometr','km'], ['kilometry','km'], ['kilometrów','km'],
  ['m','m'], ['meter','m'], ['meters','m'], ['metr','m'], ['metry','m'], ['metrów','m'],
  ['kg','kg'], ['kilogram','kg'], ['kilograms','kg'], ['kilogramów','kg'],
  ['gb','gb'], ['mb','mb'], ['tb','tb'], ['hz','hz'], ['fps','fps'],
  // Pozostałe przypadki: „po 5 minutach”, „przez godzinę”, „w 10 sekund”, „w 3 dniach”, „od 2 lat”.
  ['minutę','minute'], ['minucie','minute'], ['minutach','minute'], ['minutami','minute'], ['minutom','minute'],
  ['godzinę','hour'], ['godzinie','hour'], ['godzinach','hour'], ['godzinami','hour'], ['godzinom','hour'],
  ['sekundę','second'], ['sekundzie','second'], ['sekundach','second'], ['sekundami','second'], ['sekundom','second'],
  ['dniach','day'], ['dniami','day'],
  // Celowo bez „roku”, „latach” i „dniu”: „z 2013 roku”, „w latach 2010”, „w dniu 5 maja” to daty, nie wartości z jednostką.
  ['°c','celsius'], ['°f','fahrenheit'], ['zł','pln'], ['pln','pln'], ['usd','usd'], ['eur','eur'], ['%','percent'],
]);
function wyodrebnijJednostkoweWartosci(value) {
  const text = String(value || '').toLocaleLowerCase('pl-PL').replace(/,/g, '.')
    // Dekada nie jest ilością lat: porównuje ją wyodrębnianie dat powyżej.
    .replace(/\b(?:19|20)\d{2}\s*s\b/gu, ' ')
    .replace(/\blat(?:ach)?\s+['’]?\d{2}\b/gu, ' ')
    .replace(/\b['’]\d{2}\s*s\b/gu, ' ');
  const unitPattern = '(?:' + [...UNIT_ALIASES.keys()].filter(k => k !== 'm' && k !== 's').sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
  const out = [];
  const re = new RegExp(`(?:\\b(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})(?=$|[^\\p{L}\\p{N}])|(${unitPattern})(?=$|[^\\p{L}\\p{N}])\\s*(\\d+(?:\\.\\d+)?))`, 'giu');
  for (const m of text.matchAll(re)) {
    const amount = Number(m[1] || m[4]);
    const rawUnit = String(m[2] || m[3] || '').toLocaleLowerCase('pl-PL');
    const unit = UNIT_ALIASES.get(rawUnit);
    if (Number.isFinite(amount) && unit) out.push(`${amount}:${unit}`);
  }
  // Granice jednostki „m”/„s” muszą rozumieć polskie litery: \b traktuje „ą/ę/ó…” jako nie-litery,
  // więc „3 są” dawało „3 s” (sekundy), a „5 mężczyzn” dawało „5 m” (metry).
  const shortUnitRe = /(?:(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s+(m|s)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(m|s)\s+(\d+(?:\.\d+)?)(?![\p{L}\p{N}]))/giu;
  for (const m of text.matchAll(shortUnitRe)) {
    const amount = Number(m[1] || m[4]);
    const unit = UNIT_ALIASES.get(String(m[2] || m[3] || '').toLocaleLowerCase('pl-PL'));
    if (Number.isFinite(amount) && unit) out.push(`${amount}:${unit}`);
  }
  return [...new Set(out)];
}
function wyodrebnijNazwyWlasne(value, options = {}) {
  const raw = String(value || '');
  // Pomijamy częste słowa opisowe na początku zdania, ale nie imiona.
  // Wcześniejsze wykluczenie Artur/Arthur odrzucało poprawne nazwy własne.
  const genericFirstWords = new Set([
    'decyzja', 'motywuje', 'nowo', 'następnie', 'nastepnie', 'ponadto', 'alternatywnie', 'alternatywnymi', 'możesz', 'mozesz',
    'aby', 'dodatkowo', 'jednak', 'ogólnie', 'ogolnie', 'wtedy', 'potem', 'dlatego',
    'obecnie', 'później', 'pozniej', 'wcześniej', 'wczesniej',
    'ponieważ', 'poniewaz', 'chociaż', 'chociaz', 'choć', 'choc',
    'jeśli', 'jesli', 'gdy', 'kiedy', 'podczas', 'wreszcie',
    'większość', 'wiekszosc', 'część', 'czesc', 'każdy', 'kazdy', 'dwóch', 'dwoch', 'two', 'three', 'four', 'several', 'many',
    'pierwszy', 'drugi', 'trzeci', 'można', 'mozna', 'może', 'moze',
    'jest', 'są', 'sa', 'był', 'byla', 'było', 'bylo', 'byli',
    'to', 'ten', 'ta', 'te', 'jego', 'jej', 'oni', 'one', 'smoki', 'najlepszym', 'gracz', 'gracze', 'wrog', 'postać', 'postac', 'pytanie', 'odpowiedź', 'odpowiedz',
    'przeciw', 'przed', 'przez', 'po', 'podczas', 'dzięki', 'dzieki', 'wokół', 'wokol', 'wśród', 'wsrod', 'według', 'wedlug', 'zanim', 'mimo', 'wskutek', 'dowiedziawszy',
    'misja', 'misji', 'mission', 'quest', 'transfer', 'core', 'initial', 'first',
    'zrodlo', 'zrodla', 'zrodlem', 'source', 'sources', 'opis', 'opisuje', 'description',
    'a', 'an', 'the', 'if', 'it', 'he', 'she', 'they', 'we', 'you', 'his', 'her', 'their',
    'this', 'these', 'those', 'once', 'with', 'against', 'during', 'after', 'before', 'from', 'for', 'as',
    'how', 'why', 'when', 'where', 'who', 'what', 'which', 'while', 'then', 'also', 'one', 'two',
    'znajduje', 'znaleziono', 'położony', 'polozony', 'broń', 'bron', 'sposób', 'sposob', 'metoda', 'warto', 'użyj', 'uzyj', 'należy', 'nalezy',
    'later', 'another', 'eventually', 'meanwhile', 'afterward', 'afterwards', 'sometime', 'suddenly', 'finally',
    // Polskie słowa funkcyjne i czasowniki rozkazujące na początku claimu („Nie ma potwierdzenia…”,
    // „Strzelaj z łuku…”). Lookup idzie po normalizujClaim(), więc wystarczą formy bez znaków diakrytycznych.
    // Bez tego takie słowo było traktowane jak nazwa własna i musiało wystąpić w (angielskim) dowodzie.
    'nie', 'brak', 'bez', 'dla', 'pod', 'nad', 'przy', 'zeby', 'ale', 'lub', 'czy', 'tak', 'tylko', 'nawet', 'juz', 'nadal', 'wciaz',
    'rowniez', 'takze', 'zatem', 'wiec', 'natomiast', 'lecz', 'jezeli', 'skoro', 'pomimo', 'trzeba', 'smok',
    'zrobil', 'zrobila', 'zrobili', 'strzelaj', 'atakuj', 'unikaj', 'zaatakuj', 'skorzystaj', 'wykorzystaj', 'pamietaj', 'sprobuj',
    'zacznij', 'pokonaj', 'zabij', 'walcz', 'trzymaj', 'zwieksz', 'powtarzaj', 'powtorz',
    'najpierw', 'jednoczesnie', 'takie', 'kontynuuj', 'zastosuj', 'miecz', 'wozek', 'wozka',
    'udaje', 'udala', 'udalo', 'udac',
    // Przysłówki i okoliczniki na początku zdania były zliczane jako encje,
    // przez co tłumaczenie poprawnej nazwy wyglądało jak utrata encji
    // („Najłatwiej dotrzeć do wózka…” → „The easiest way to get there…”).
    'najlatwiej', 'najprościej', 'najszybciej', 'najczesciej', 'zazwyczaj', 'przede',
    // „Dokładny moment…” to opis, nie encja; występował jako fałszywa nazwa własna
    // i powodował odrzucenie poprawnego angielskiego tłumaczenia „The exact moment…”.
    'dokladny', 'dokladna', 'dokladne', 'dokladnego', 'dokladnej', 'dokladnym',
    // Liczba mnoga rzeczownika pospolitego: „postać” była na liście, „postacie” nie.
    'postacie', 'postaci', 'bohaterzy', 'bohaterowie',
    // Kwantyfikatory na początku zdania nie są nazwami własnymi (np. „Wszystkie te działania…”).
    'wszystkie', 'wszystkich', 'wszystko', 'wszelkie', 'wszyscy', 'wszystkim', 'każde', 'kazde', 'każda', 'kazda', 'każdy', 'kazdy', 'każdym', 'kazdym',
    // Rzeczownik pospolity na początku claimu nie może zostać uznany za encję.
    // W live benchmark „Przejęcie kontroli przez Wheatleya…” było błędnie
    // odrzucane, bo „Przejęcie” nie występowało w angielskim claim_en jako nazwa.
    'przejecie', 'przejecia', 'przejeciu', 'przejeciem', 'przejec',
    // Common sentence-initial nouns seen in the live benchmark are descriptions,
    // not proper names. Keep strict evidence, number, and date checks unchanged.
    'rodzinne', 'rodzinna', 'rodzinny', 'rodzinnego', 'rodzinnej', 'rodzinnym', 'polowanie', 'polowania', 'polowaniem', 'polowaniu', 'wedrowanie', 'wedrowania', 'wedrowaniem', 'wedrowaniu', 'damy', 'dama', 'struktura', 'struktury', 'strukture', 'strukturze', 'wiedzmin', 'wiedzmina', 'wiedzminem', 'wiedzminie', 'forteca', 'fortecy', 'fortece', 'twierdza', 'twierdzy', 'twierdze',
    // Zwykłe słowa otwierające zdanie z przypadków false-rejection.
    'materialy', 'dostepne', 'dostepnych', 'danych', 'jedynym', 'jedyna', 'jedynie', 'ponadto', 'dodatkowo', 'aby', 'jesli', 'relacja', 'relacji', 'relacje', 'poznanie', 'poznania'
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
  // Tytuł gry powtórzony w claimie to kontekst pytania, nie fakt do potwierdzenia w cytacie
  // (patrz TYTULY_GIER). Zwalniamy go z wymogu obecności w dowodzie tylko na żądanie wywołującego;
  // pozostałe nazwy własne claimu nadal muszą wystąpić w dowodzie.
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
  const capitalizedRe = /(?<![\p{L}\p{N}_])[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*/gu;
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
          // Świadomy kompromis: wymyślona nazwa występująca wyłącznie na początku claimu
          // i nieobecna w źródłach może zostać pominięta. Inne kontrole pozostają aktywne;
          // nazwy w środku zdania nadal są ściśle wymagane w dowodzie.
          if (Array.isArray(options._ignoredSentenceInitialNames)) options._ignoredSentenceInitialNames.push(token);
          continue;
        }
      }
      candidates.push({ token, offset: sentenceOffset + tokenOffset });
    }
  }

  // Zachowujemy apostrofy i polskie znaki; normalizacja służy wyłącznie
  // do porównywania nazw, nie może zmieniać "Johnny'ego" w "johnny ego".
  const normalizujNazwe = (text) => String(text || '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}'’.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [...new Set(candidates
    .map(item => normalizujNazwe(item.token))
    .filter(name => name.length >= 3))];
}
function tekstDoWykrywaniaNegacji(value) {
  // Konstrukcje warunkowe „if/when not X, Y”, „unless X, Y”, „jeśli/jeżeli/gdy/kiedy
  // nie X, to Y” oraz „chyba że X, Y” zawierają negację w protazie, ale nie
  // odwracają polaryzacji faktycznego claimu w apodozie. Na przykład:
  //   „If not chosen as the player character, Astarion may be encountered …”
  // to nie twierdzenie o tym, że Astarion NIE występuje w grze. Usuwamy taką
  // wprowadzającą frazę PRZED normalizacją, bo normalizacja zamienia przecinki
  // na spacje i rozmywa granicę zdania podrzędnego.
  let cleaned = String(value || '');
  cleaned = cleaned.replace(/\b(?:if|when)\s+not\s+[^,.!?;:]*?\s*[,;:]/giu, ' ');
  cleaned = cleaned.replace(/\bunless\s+[^,.!?;:]*?\s*[,;:]/giu, ' ');
  cleaned = cleaned.replace(/\b(?:jesli|jeśli|jezeli|jeżeli|gdy|kiedy)\s+nie\s+[^,.!?;:]*?\s*(?:[,;:]|\sto\s)/giu, ' ');
  cleaned = cleaned.replace(/\bchyba\s*że\s+[^,.!?;:]*?\s*[,;:]/giu, ' ');
  cleaned = cleaned.replace(/\bchyba\s*ze\s+[^,.!?;:]*?\s*[,;:]/giu, ' ');

  let text = normalizujClaim(cleaned);

  // Frazy metajęzykowe i retoryczne zawierają „nie/not”, ale nie odwracają
  // polaryzacji opisywanego faktu: „nie możemy zapomnieć o Astarionie” znaczy,
  // że Astarion jest ważny, a nie że go nie ma.
  text = text.replace(
    /(?:^|\b)(?:nie mozemy zapomniec|nie mozna zapomniec|nie zapominajmy|nie zapominaj|do not forget|not to mention)\b/gu,
    ' ',
  );

  // „lack/absence of stability” opisuje niestabilność; nie jest negacją
  // następnego orzeczenia („lack of stability will cause destruction”).
  // Pozostawiamy „lack/absence of siblings” jako sygnał braku konkretnej encji.
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
    .replace(/[^\p{L}\p{N}'’.-]+/gu, '')
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
  const capitalizedRe = /(?<![\p{L}\p{N}_])[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*/gu;
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

  // Apostrof w odmianie obcego imienia oddziela rdzeń od końcówki:
  // Johnny’ego -> Johnny.
  const apostropheBase = token.replace(/['’]\p{L}+$/u, '');
  if (apostropheBase.length >= 4 && apostropheBase !== token) variants.add(apostropheBase);

  // Angielska forma dzierżawcza: Alt’s -> Alt. Nazwy mają co najmniej 3 znaki,
  // więc rdzeń krótszy niż 4 znaki (np. „Alt”) też musi być rozpoznany.
  const possessive = token.match(/^(.{3,})['’]s$/u);
  if (possessive) variants.add(possessive[1]);

  // Ograniczona obsługa odmiany nazw obcych: wymagamy dokładnego rdzenia
  // w źródle zamiast ryzykownego dopasowania dowolnego prefiksu.
  const suffixes = ['owego', 'owej', 'owym', 'owie', 'ami', 'ach', 'ego', 'emu', 'owi', 'iego', 'iej', 'ów', 'om', 'em', 'ie', 'a', 'ę', 'ą', 'y', 'i', 'u', 'e'];
  for (const suffix of suffixes) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      variants.add(token.slice(0, -suffix.length));
    }
  }
  // Mianownik rzeczowników żeńskich na -a: Arasakę/Arasaki -> Arasaka, Arasace -> Arasaka.
  // Znaki diakrytyczne są już usunięte, więc „ę” widać jako „e”. Samo odcięcie końcówki
  // dawało rdzeń („arasak”), którego nie ma w tekście źródłowym jako osobnego tokenu.
  if (/[eyi]$/u.test(token) && token.length - 1 >= 4) variants.add(token.slice(0, -1) + 'a');
  if (token.endsWith('ie') && token.length - 2 >= 4) variants.add(token.slice(0, -2) + 'a');
  // Miejscownik z przemianą spółgłoski: Novigradzie -> Novigrad, Velenie -> Velen (już obsłużone), Hindarsfjalle itp.
  const alternations = [['ście', 'st'], ['scie', 'st'], ['dzie', 'd'], ['cie', 't'], ['rze', 'r'], ['sie', 's'], ['zie', 'g']];
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
      if (normalized.every((token, offset) => evidenceTokens[start + offset] === token)) return true;
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
  const score = fragment => {
    const fragmentTokens = tokenyPokryciaBezStop(fragment);
    const shared = claimTokens.filter(token => fragmentTokens.some(other => tokenyPokrywajaSie(token, other)));
    return shared.length / claimTokens.length;
  };
  let best = fragments[0];
  let bestScore = score(best);
  for (const fragment of fragments.slice(1)) {
    const fragmentScore = score(fragment);
    if (fragmentScore > bestScore) { best = fragment; bestScore = fragmentScore; }
  }
  return bestScore >= 0.2 ? best : String(evidence || '');
}

function sprawdzPowiazanieLiczbZeZdarzeniem(evidence, claim, options = {}) {
  if (options.allowDistributedEvidence || wyglądaNaAngielski(evidence) !== wyglądaNaAngielski(claim)) return { ok: true };
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
  const bestOverallScore = Math.max(...sentences.map(score));
  const numericSentences = sentences.filter(sentence => {
    const numbers = wyodrebnijLiczbyIDaty(sentence);
    return claimNumbers.every(number => numbers.includes(number));
  });
  if (!numericSentences.length) return { ok: true };
  const bestNumericScore = Math.max(...numericSentences.map(score));
  if (bestOverallScore >= 0.35 && bestOverallScore - bestNumericScore >= 0.25) return { ok: false, reason: 'wartość liczbowa występuje przy innym zdarzeniu niż w claimie' };
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
    // „take no damage” (kwantyfikator zerowy, bez żadnego innego zaprzeczenia w dowodzie) potwierdza pozytywny
    // claim o redukcji („zmniejsza obrażenia”). Każde inne rozjechanie negacji nadal jest twardym konfliktem.
    const zerowyKwantyfikator = !claimNegated && evidenceNegated
      && !wyodrebnijMarkery(e, NEGATION_STRICT_RE)
      && wyodrebnijMarkery(c, REDUCTION_RE);
    if (!zerowyKwantyfikator) return { ok: false, reason: 'claim i dowód mają inną negację' };
  }
  if (options.checkNegationOnly) return { ok: true };

  const evidenceNumbers = wyodrebnijLiczbyIDaty(e);
  // Numerał w tytule gry („Baldur's Gate 3”, „Cyberpunk 2077”) nie jest faktem do potwierdzenia w cytacie
  // (patrz TYTULY_GIER); zwalniamy go, chyba że dowód wspomina inną część tej samej serii.
  const cBezTytulow = usunTytulyGierZLiczb(c, e);
  const claimNumbers = wyodrebnijLiczbyIDaty(cBezTytulow);
  if (claimNumbers.some(n => !evidenceNumbers.includes(n))) return { ok: false, reason: 'claim zawiera liczbę/datę nieobecną w dowodzie' };

  const evidenceQuantities = wyodrebnijJednostkoweWartosci(e);
  const claimQuantities = wyodrebnijJednostkoweWartosci(c);
  if (claimQuantities.some(q => !evidenceQuantities.includes(q))) return { ok: false, reason: 'claim zawiera wartość liczbową z niezgodnymi lub niepotwierdzonymi jednostkami' };
  const numericAssociation = sprawdzPowiazanieLiczbZeZdarzeniem(e, c, options);
  if (!numericAssociation.ok) return numericAssociation;

  const claimTemporal = wyodrebnijMarkery(cBezTytulow, TEMPORAL_RE);
  const evidenceTemporal = wyodrebnijMarkery(e, TEMPORAL_RE);
  if (claimTemporal && !evidenceTemporal && claimNumbers.length === 0) return { ok: false, reason: 'claim zawiera sygnał czasowy nieobecny w dowodzie' };
  return { ok: true };
}

function sprawdzSprzecznosciSemantyczne(evidence, claim) {
  const normalizedEvidence = normalizujClaim(evidence);
  const normalizedClaim = normalizujClaim(claim);
  // Catch a concrete translation mismatch (cart vs basket) without treating
  // every mention of a cart as a required cross-language concept. In route
  // instructions, Polish "wózek" may be naturally rendered as "get there".
  const evidenceCart = /\b(?:cart|carriage|wagon)\b|\bwoz(?:u|em|ie|y|ow|ami|ach)?\b|\bwozek\b|\bwozka\b|\bwozkiem\b|\bwozki\b|\bwozkow\b|\bwozkami\b|\bwozkach\b/i.test(normalizedEvidence);
  const claimCart = /\b(?:cart|carriage|wagon)\b|\bwoz(?:u|em|ie|y|ow|ami|ach)?\b|\bwozek\b|\bwozka\b|\bwozkiem\b|\bwozki\b|\bwozkow\b|\bwozkami\b|\bwozkach\b/i.test(normalizedClaim);
  const evidenceBasket = /\bbaskets?\b|\bkosz\w*\b/i.test(normalizedEvidence);
  const claimBasket = /\bbaskets?\b|\bkosz\w*\b/i.test(normalizedClaim);
  if ((evidenceCart && claimBasket && !claimCart) || (evidenceBasket && claimCart && !claimBasket)) {
    return { ok: false, reason: 'claim błędnie tłumaczy wóz/wózek jako kosz/basket lub odwrotnie' };
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
    return { ok: false, reason: 'claim twierdzi brak stabilności, a dowód wskazuje stabilność' };
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
  if (cAction.killed && eAction.captured && !eAction.killed) return { ok: false, reason: 'claim zawiera zabójstwo, a dowód potwierdza jedynie schwytanie/porwanie' };
  if (cAction.captured && eAction.killed && !eAction.captured) return { ok: false, reason: 'claim zawiera schwytanie/porwanie, a dowód potwierdza zabójstwo' };
  // Przejęcie kontroli nie jest zniszczeniem (i odwrotnie): para działa w obu kierunkach,
  // więc „przejął kontrolę” ↔ „destroyed” jest wykrywane ogólnie, bez wyjątków dla konkretnych zdań.
  const opposites = [['porwanie','zabojstwo'], ['obrazenia','zabojstwo'], ['pomoc','kontrola'], ['porazka','kontrola'], ['kontrola','destrukcja']];
  for (const [a,b] of opposites) {
    if (cConcepts.has(b) && eConcepts.has(a) && !eConcepts.has(b)) return { ok: false, reason: 'claim zawiera sprzeczne działanie względem dowodu' };
    if (cConcepts.has(a) && eConcepts.has(b) && !eConcepts.has(a)) return { ok: false, reason: 'claim zawiera sprzeczne działanie względem dowodu' };
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
    // Nazwa własna z polskiego claimu nie występuje w angielskim dowodzie. Jeśli
    // model nie zwrócił tłumaczenia claim_en, nie da się rozstrzygnąć, czy nazwa
    // ma zweryfikowany odpowiednik w drugim języku, czy została wymyślona.
    // Powód musi to mówić wprost — nazwa braku nazwy własnej
    // sugerowała problem z treścią odpowiedzi, a problem leży w kontrakcie.
    if (!options.claimEn && wyglądaNaAngielski(evidence)) {
      return { ok: false, reason: 'brak tłumaczenia claimu (claim_en) dla angielskiego dowodu — nazw własnych nie da się rozstrzygnąć', ignoredSentenceInitialNames };
    }
    return { ok: false, reason: 'dowód nie zawiera wszystkich istotnych nazw własnych claimu', ignoredSentenceInitialNames };
  }
  if (sharedConcepts.length >= 2) return { ok: true, mode: 'multiple_cross_language_concepts', sharedConcepts, overlap, ignoredSentenceInitialNames };
  if (sharedConcepts.length >= 1 && entities.length >= 1) return { ok: true, mode: 'concept_and_entity', sharedConcepts, overlap, ignoredSentenceInitialNames };
  if (overlap >= (entities.length ? 0.34 : 0.45)) return { ok: true, mode: 'token_overlap', overlap, sharedConcepts, ignoredSentenceInitialNames };
  if (sharedConcepts.length >= 2) return { ok: true, mode: 'multiple_concepts', sharedConcepts, overlap, ignoredSentenceInitialNames };
  return { ok: false, reason: `zbyt małe pokrycie semantyczne (${overlap.toFixed(2)})`, ignoredSentenceInitialNames };
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
  const relationRe = /(?<![\p{L}])(?:bo|poniewaz|gdyz|dlatego|z powodu|dzieki|spowod\w*|doprowadz\w*|umozliw\w*|because|therefore|due to|caus\w*|led to|leading to|lead\w*\s+(?:\w+\s+){0,3}to|resulted in|resulting in|so\s+(?:approach|use|avoid|keep|stay|choose|take|do|be)|so\s+that|in\s+order\s+to|so\s+as\s+to|thereby|thus|w\s+ten\s+sposob|przez\s+co|co\s+(?:umozliw\w*|spowod\w*)|allow(?:s|ed|ing)?|enabl(?:e|es|ed|ing)|accidentally|by mistake|which\s+(?:let|lets|allowed|allows|enabled|enables)|putting\s+(?:him|her|them|it)\s+in\s+control|giving\s+(?:him|her|them|it)\s+control|force(?:s|d|ing)?\s+(?:the\s+)?[\w'-]+(?:\s+[\w'-]+){0,1}\s+to\s+[\w'-]+)(?![\p{L}])/iu;
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

  // Conditional evidence ("only if", "unless", "jeśli ...") does not prove the
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
    return { ok: false, reason: 'claim zawiera wartość liczbową z niezgodnymi lub niepotwierdzonymi jednostkami' };
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

  // Akceptujemy sensowną parafrazę, ale tylko po przejściu twardych
  // konfliktów/liczb/jednostek. To naprawia false rejecti bez otwierania
  // walidatora na dowolne podobieństwo tekstowe.
  // Minimalnie niższy próg parafrazy, przy zachowaniu pełnego pokrycia
  // encji albo wspólnego pojęcia. Twarde kontrole liczb, negacji i przyczyn
  // wykonują się wcześniej i pozostają bez zmian.
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
function tokenyPokrywajaSie(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6) return false;
  let prefixLength = 0;
  while (prefixLength < Math.min(a.length, b.length) && a[prefixLength] === b[prefixLength]) prefixLength++;
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
  // „metod\w*” i „sposob\w*”: zastrzeżenie o braku dodatkowych metod w źródłach („Źródła nie podają
  // dodatkowych metod zdobycia…”) jest tak samo zakresem źródła jak brak daty, a nie faktem o świecie.
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
  const sourceSentences = usunEtykietyDowodow(answer).split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  const sentences = sourceSentences.flatMap((sentence, sourceSentenceIndex) => {
    // Wskazanie źródła w nawiasie („(Źródło: opis lokalizacji…)”) to metadane,
    // nie twierdzenie o świecie. Bez tego zdanie nigdy nie ma pokrycia, bo
    // żaden claim nie opisuje metadanych.
    // Usuwamy WYŁĄCZNIE sam nawias ze źródłem (razem z zamykającym nawiasem), a nie
    // ogon zdania — inaczej treść po „(Źródło: …)” uciekałaby spod kontroli pokrycia.
    const withoutSource = sentence.replace(/\s*[([{]\s*(?:źród(?:a|ła|ło|em|ami)?|source(?:s)?)\s*:[^)\]}]*[)\]}]/giu, '').trim();
    // Zdanie bez liter i cyfr po usunięciu źródła (np. sama kropka) nie jest twierdzeniem.
    if (!/[\p{L}\p{N}]/u.test(withoutSource)) return [];
    const base = withoutSource;
    // Oceniaj osobno koordynowane klauzule faktograficzne. Bez tego jedna
    // dobrze pokryta część zdania może „zamaskować” drugą, niepopartą część.
    // Nie rozbijamy zwykłych list rzeczowników (np. „ogień, mróz i magia”):
    // separator musi być przecinkiem przed spójnikiem albo średnikiem.
    const clauses = base
      .split(/;\s*|,\s*(?=(?:and\s+then|and|but|then|while|or|a\s+(?:potem|następnie|nastepnie)|ale|jednak|następnie|nastepnie|oraz)\b)/iu)
      .map(part => part.trim())
      .filter(Boolean);
    if (clauses.length > 1) return clauses.map(text => ({ text, sourceSentenceIndex }));
    const match = base.match(/^(.*?)[,;]?\s+(?:ale|jednak)\s+(.+)$/iu);
    if (match && czyOgraniczenieDowodowe(match[2])) {
      return [match[1].trim(), match[2].trim()].filter(Boolean).map(text => ({ text, sourceSentenceIndex }));
    }
    return [{ text: base, sourceSentenceIndex }];
  });
  const claimRows = (Array.isArray(claims) ? claims : [])
    .map(c => ({
      tokens: tokenyPokrycia(c?.claim || ''),
      concepts: pojeciaCrossLanguage(c?.claim || ''),
      entities: wyodrebnijNazwyWlasne(c?.claim || ''),
      numbers: liczbyDoPorownania(c?.claim || ''),
    }))
    .filter(row => row.tokens.length >= 2 || row.concepts.size || row.entities.length);

  const uncovered = [];
  let checkedSentences = 0;

  // Zdanie zaczynające się zaimieniem („Jego historia…”) nie nazywa podmiotu,
  // więc nie da się go dopasować do claimu po nazwie. Podmiot dziedziczy po
  // poprzednim zdaniu, a z nim także encje — bez tego zdanie nigdy nie ma pokrycia.
  // Demonstratywy („to”, „te”, „ten”, „ta”) celowo NIE są tu anaforą: wskazują
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
      // Podmiot dziedziczymy z najbliższego poprzedniego zdania, które podmiot
      // nazywa wprost. Zdania też zaimiennicze („Jest postacią Origin…”) podmiotu
      // nie wskazują, więc je pomijamy i szukamy dalej.
      for (let back = sentenceIndex - 1; back >= 0; back--) {
        const previous = sentences[back]?.text;
        if (!previous || czyOgraniczenieDowodowe(previous)) continue;
        const previousEntities = wyodrebnijNazwyWlasne(previous);
        if (!previousEntities.length) continue;
        if (ANAPHORA.test(previous) || /^\s*(?:jest|są|był|była|było|byli|miał|miała|ma)\b/iu.test(previous)) continue;
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
        // Zdanie anaforyczne („Jego historia…”) nie powtarza podmiotu, więc
        // jego pokrycie leksykalne z definicji jest niskie. Kotwicą jest rozwiązana
        // encja: jeśli claim o tej samej encji potwierdza treść zdania, zdanie jest
        // pokryte. Próg tokenowy jest tu niższy, bo encja weryfikuje tożsamość.
        //
        // Niskie pokrycie leksykalne oznacza jednak, że zdanie może wnieść treść,
        // której claim nie potwierdza. Liczby są tu najostrzejszą granicą:
        // claim dzielący z zdaniem jedno słowo („lat”) pokrywałby zdanie
        // „Jego historia trwa trzysta lat”, mimo że tej liczby nie ma w dowodzie.
        // Liczba w zdaniu anaforycznym musi więc występować w spójnym claimie.
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
    // Zdanie anaforyczne kotwiczy się w rozwiązanej encji: gdy istnieje spójny
    // claim o tej samej encji, zdanie jest pokryte mimo niskiego pokrycia
    // leksykalnego (podmiot nie jest powtórzony w tekście). Liczymy encję
    // wspólną z tym claimem, nie cały odziedziczony zbiór.
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
  return zgodnoscStrukturalna(evidence, claim, options).ok;
}
// --- Tłumaczenie claimu (claim_en) -------------------------------------------------------------
// Polski claim kontra angielskie źródło dawał pokrycie leksykalne ~0,25, bo wspólne są tylko nazwy
// własne. Walidator zwraca więc dodatkowo claim_en i twarde kontrole (liczby, nazwy, negacja,
// przyczyna) robimy w jednym języku. Tłumaczenie pisze jednak model, więc nie wolno mu ufać:
// musi zgadzać się z oryginałem w tym, co da się sprawdzić mechanicznie.
const EN_FUNCTION_WORDS = /(?<![\p{L}])(?:the|of|and|is|was|were|are|to|in|for|with|that|he|she|his|her|by|on|as|at|it|its|from|after|before|during|has|had|have|an|this|these|those|their|be|been|not|which|who|can|will|may|only|also|than|then|but|or|if|when|where|lasts?|takes?|does|did)(?![\p{L}])/giu;
// Polskie słowa funkcyjne: ich obecność wyklucza tekst angielski nawet bez znaków diakrytycznych.
// Tylko słowa, które w angielskim NIE występują jako samodzielne słowa.
// „do”, „w”, „z”, „i”, „a”, „to” są celowo pominięte — wszystkie występują
// po angielsku, a ich dopisanie odwróciłoby wykrywanie dla prawdziwych
// angielskich źródeł (czyli dla tej ścieżki, którą claim_en obsługuje).
// Z tego samego powodu usunięto „ale” (ang. piwo), „po”, „bo” i „jak”
// („Jak and Daxter”) — występują w angielskich tekstach o grach.
const PL_FUNCTION_WORDS = /(?<![\p{L}])(?:jest|się|sie|nie|że|ze|przez|oraz|który|która|które|jego|jej|ich|dla|od|czy|gdy|są|był|była|było|były|trwa|walka|gra|gdzie|przy|także|również|jednak|ponieważ|zatem|więc|wszystkie|wszystkich|można|należy|szukać|tylko|nadal|wciąż|według|blisko|daleko|część|większość|musi|każdy|każda|wszystko|nic|ktoś|zawsze|nigdy|właśnie|bardzo|choć|chociaż|ponadto|wobec|około)(?![\p{L}])/iu;

// Polskie czasowniki 3. os. liczby pojedynczej: „przybywa”, „zostaje”.
// Końcówki „-wa” i „-uje” nie występują w angielskim w tej pozycji
// (wyjątki typu „Iowa” są nazwami własnymi, więc je pomijamy).
const PL_VERB_ENDINGS = /(?:^|[^\p{Lu}])[\p{Ll}]{3,}(?:wa|uje)(?![\p{L}])/u;

function wyglądaNaAngielski(text) {
  const t = String(text || '');
  if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(t)) return false;
  if (PL_FUNCTION_WORDS.test(t)) return false;
  if (PL_VERB_ENDINGS.test(t)) return false;
  // Krótki claim typu „Malenia defeated Radahn.” nie ma słów funkcyjnych, ale też nie ma polskich.
  return (t.match(EN_FUNCTION_WORDS) || []).length >= 1 || t.trim().split(/\s+/).length >= 3;
}

function zbiorRowny(a, b) {
  const sa = new Set(a); const sb = new Set(b);
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}

// Wycina z tekstu wzmianki o encjach należących do tej samej grupy aliasowej.
// Zweryfikowane nazwy PL/EN nie zawsze mają wspólne tokeny, więc porównanie
// treści z ich udziałem mogłoby dać fałszywy negatyw. Wycinamy grupę po obu
// stronach, żeby porównać resztę; niezweryfikowane aliasy nie trafiają do tabeli.
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
    } catch (_) { /* pomijamy wzorzec, którego nie da się zastosować */ }
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Liczby do porównania w obrębie jednego języka (odpowiedź ↔ claim).
// Łączy zapis cyfrowy i słowny, bo model miesza oba zapisy w jednym tekście.
// Nie wolno używać tego do porównania claimu z angielskim dowodem.
function liczbyDoPorownania(tekst) {
  return [...new Set([...wyodrebnijLiczbyIDaty(tekst), ...slowaLiczbowe(tekst)])];
}

// Angielskie liczby słowne zamieniane na cyfry wyłącznie w kontrolę parytetu PL↔EN claimu:
// „około 20 lat” ↔ „over twenty years”. Wersja z cyframi jest DODATKOWĄ ścieżką akceptacji obok
// surowego tłumaczenia, więc nie tworzy nowych odrzuceń (np. „dwadzieścia lat” ↔ „twenty years”).
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

// Czy w cytacie po zachowanym imieniu stoi inny wyraz pisany wielką literą („Johnny Cash”)?
// Wtedy cytat mówi o innej osobie niż „Johnny Silverhand” i skrót imienia nie może być uznany
// za tę samą encję. Interpunkcja kończąca token przerywa nazwę; „’s” jest odcinane.
// Odpowiednik followedByForeignSurname z ai/entities.js, ale działający na cytacie.
function cytatRozszerzaNazwePoImieniu(quote, nameVariants) {
  const tokens = String(quote || '').split(/\s+/u).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (/[.!?,;:)]$/u.test(tokens[i])) continue;
    if (!nameVariants.has(normalizujClaim(tokens[i].replace(/['’]s$/iu, '')))) continue;
    if (/^[A-ZĄĆĘŁŃÓŚŹŻ]/u.test(tokens[i + 1])) return true;
  }
  return false;
}

function spojnoscTlumaczeniaClaimu(claimPl, claimEn, options = {}) {
  const pl = String(claimPl || '').trim();
  const en = String(claimEn || '').trim();
  if (!pl || !en) return { ok: false, reason: 'brak tłumaczenia claimu' };
  if (en.length > pl.length * 3 + 60) return { ok: false, reason: 'tłumaczenie claimu jest nieproporcjonalnie długie' };
  if (!wyglądaNaAngielski(en)) return { ok: false, reason: 'claim_en nie wygląda na tekst angielski' };
  // Zbieżność claim_en z cytatem sama w sobie nie dowodzi błędu: poprawny claim
  // może być wiernym tłumaczeniem zdania źródłowego. Jeśli jednak model skopiował
  // cały cytat, wymagamy też pozytywnej zgodności semantycznej PL→EN; inaczej
  // późniejsza walidacja mogłaby porównać cytat z samym sobą zamiast z claimem.
  const quoteNorm = normalizujClaim(options.evidenceQuote || '');
  const copiedQuote = Boolean(quoteNorm) && normalizujClaim(en) === quoteNorm;
  if (copiedQuote) {
    // Powód odrzucenia zachowuje diagnostykę sprzeczności (np. zabójstwo vs schwytanie),
    // zamiast ją zastępować ogólnym komunikatem.
    const konfliktCytatu = sprawdzSprzecznosciSemantyczne(pl, en);
    const powodNiezgodnosci = konfliktCytatu.ok
      ? 'claim_en kopiuje cytat, ale nie odpowiada treści claimu'
      : 'claim_en kopiuje cytat, ale nie odpowiada treści claimu: ' + konfliktCytatu.reason;
    // Wycinamy aliasowane encje z obu stron i porównujemy RESZTĘ treści.
    // Bez tego kopiowanie cytatu czyniło weryfikację tautologiczną: claim_en
    // jest wtedy cytatem, więc „dowód zgodny z claim_en” niczego nie dowodzi,
    // a jedynym strażnikiem zostaje słownik pojęć (z lukami).
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
    // „zniszczył Aperture” must not pass against „took control of Aperture”.
    // The same applies when the concept dictionary recognizes neither action:
    // if claim_en is a verbatim quote, the quote cannot validate its own translation.
    // In that case we abstain until the PL↔EN action can be checked, rather than
    // silently treating a shared character/place name as proof of semantic equivalence.
    // Gdy sam claim jest już po angielsku, cytat może być weryfikowany
    // bezpośrednio przez późniejsze kontrole liczb, negacji, relacji i nazw.
    // Dla polskiego claimu kopiowanie angielskiego cytatu wymaga jednak
    // przynajmniej jednego wspólnego pojęcia działania; sama encja nie wystarcza.
    const normalizedClaim = normalizujClaim(pl);
    const directSameLanguageEvidence = wyglądaNaAngielski(pl)
      && normalizedClaim.length > 0
      && quoteNorm.includes(normalizedClaim);
    if (sharedConcepts.length === 0 && !directSameLanguageEvidence) {
      return { ok: false, reason: powodNiezgodnosci };
    }
    // Do not let one shared concept excuse extra source facts in claim_en.
    // Improve the cross-language dictionary instead when a faithful equivalent
    // (such as Polish "schwytał" and English "captured") is missing.
    const addedConcepts = [...englishConcepts].filter(concept => !polishConcepts.has(concept));
    if (addedConcepts.length) {
      return { ok: false, reason: powodNiezgodnosci };
    }
    // Po wycięciu encji pojęcia muszą zgodzić się w OBIE strony. Wcześniej
    // sprawdzano tylko, że cytat nie dodaje pojęcia, którego nie ma w claimie —
    // claim mógł więc twierdzić pojęcia nieobecnego w cytacie („zniszczył”
    // wobec „took control”) i przechodzić, bo jedno wspólne pojęcie to
    // usprawiedliwiało resztę.
    const missingConcepts = [...polishConcepts].filter(concept => !englishConcepts.has(concept));
    if (missingConcepts.length) {
      return { ok: false, reason: powodNiezgodnosci };
    }
    // Zgodności leksykalnej PL↔EN tutaj nie wymagamy dla nazw z jawnie
    // zweryfikowanymi aliasami: nie muszą mieć wspólnych tokenów. Rozstrzygają zamiast tego:
    //   • zbiory pojęć powyżej (claim_en nie dodaje, nie podmienia i nie pomija
    //     pojęcia po wycięciu encji),
    //   • twarde kontrole liczb, jednostek, negacji i przyczyny poniżej,
    //   • twarda kontrola nazw własnych poniżej (claim nie może zgubić ani
    //     podmienić nazwy).
    // Kontrola dowodu na claim_en NIE jest tu strażnikiem: gdy claim_en jest
    // kopią cytatu, porównuje ona cytat z samym sobą. Dlatego powyższe trzy
    // punkty muszą wystarczać samodzielnie.
    // Bez tego warunku claim_en nigdy nie byłoby użyteczne dla nazw tłumaczonych.
  }
  // Liczby/daty obecne w polskim claimie muszą pozostać w tłumaczeniu.
  // Data dodana przez evidence/claim_en może jednak zostać bezpiecznie
  // pominięta przy uogólnieniu polskiego zdania.
  const polishNumbers = wyodrebnijLiczbyIDaty(pl);
  const enLiczbowo = angielskieLiczbySlowneNaCyfry(en);
  const englishNumbers = [...new Set([...wyodrebnijLiczbyIDaty(en), ...wyodrebnijLiczbyIDaty(enLiczbowo)])];
  if (polishNumbers.some(number => !englishNumbers.includes(number))) {
    return { ok: false, reason: 'tłumaczenie claimu zmienia liczby lub daty' };
  }
  const polishUnits = wyodrebnijJednostkoweWartosci(pl);
  if (!zbiorRowny(polishUnits, wyodrebnijJednostkoweWartosci(en))
    && !zbiorRowny(polishUnits, wyodrebnijJednostkoweWartosci(enLiczbowo))) {
    return { ok: false, reason: 'tłumaczenie claimu zmienia jednostki lub wartości' };
  }
  if (wyodrebnijMarkery(pl, NEGATION_RE) !== wyodrebnijMarkery(en, NEGATION_RE)) {
    return { ok: false, reason: 'tłumaczenie claimu zmienia negację' };
  }
  // Zmianę zdarzenia (np. „przejął kontrolę” → „destroyed”) wykrywają ogólne pary
  // przeciwstawnych pojęć w sprawdzSprzecznosciSemantyczne; tu nie ma wyjątków dla konkretnych fraz.
  const semanticConflict = sprawdzSprzecznosciSemantyczne(pl, en);
  if (!semanticConflict.ok) return { ok: false, reason: 'tłumaczenie claimu zmienia zdarzenie lub relację' };
  const polishReasonClause = /\bprzyczyn\w*\s+(?:dla\s+)?ktorej\b/u.test(normalizujClaim(pl));
  const englishReasonClause = /\b(?:the\s+)?reason\s+why\b/u.test(normalizujClaim(en));
  // „Nie ma danych potwierdzających przyczynę, dla której…” ↔
  // “There is no data confirming the reason why…” opisuje brak wiedzy,
  // a nie dokonuje nowego twierdzenia przyczynowego. CAUSAL_RE pozostaje
  // bez zmian; wyjątek dotyczy wyłącznie równoważnej konstrukcji w tłumaczeniu.
  if (wyodrebnijMarkery(pl, CAUSAL_RE) !== wyodrebnijMarkery(en, CAUSAL_RE)
    && !(polishReasonClause && englishReasonClause)) {
    return { ok: false, reason: 'tłumaczenie claimu zmienia relację przyczynową' };
  }
  if (wyodrebnijMarkery(pl, REDUCTION_RE) !== wyodrebnijMarkery(en, REDUCTION_RE)) {
    return { ok: false, reason: 'tłumaczenie claimu zmienia kierunek redukcji lub ochrony' };
  }
  const enNormalized = normalizujClaim(en);
  const claimNames = [...new Set([
    ...wyodrebnijNazwyWlasne(pl, options),
    // Re-run without the source oracle so an unknown sentence-initial proper
    // noun cannot be silently omitted from the English claim translation.
    ...wyodrebnijNazwyWlasne(pl),
  ])];
  if (copiedQuote && /^(?:who|which|that|he|she|it|they|his|her|their|its)\s/u.test(enNormalized)) {
    const evidenceContext = String(options.evidenceContext || '');
    const evidenceQuote = String(options.evidenceQuote || '').trim();
    const quoteOffset = evidenceQuote ? evidenceContext.indexOf(evidenceQuote) : -1;
    if (quoteOffset < 0) {
      return { ok: false, reason: 'tłumaczenie claimu gubi nazwy własne: ' + claimNames.slice(0, 3).join(', ') };
    }
    if (quoteOffset >= 0) {
      const sameSentencePrefix = (evidenceContext.slice(0, quoteOffset).split(/[.!?](?:\s+|$)/u).at(-1) || '');
      const normalizedPrefix = ' ' + normalizujClaim(sameSentencePrefix) + ' ';
      if (!claimNames.some(name => normalizedPrefix.includes(' ' + normalizujClaim(name) + ' '))) {
        return { ok: false, reason: 'tłumaczenie claimu gubi nazwy własne: ' + claimNames.slice(0, 3).join(', ') };
      }
    }
  }
  // Twarda kontrola: polska nazwa własna musi wystąpić w angielskim tłumaczeniu.
  // Dla nazwy przetłumaczonej rozstrzyga tabela aliasów — czyNazwaWlasnaWystepuje
  // sprawdza w niej wzorzec (PL i EN w jednym wyrażeniu), a podmiana encji
  // („Malenia” → „Radahn”) i utrata encji („Wheatley” → „He”) nadal padają.
  // Te dwie ostatnie własności
  // są pilnawcami podmiany podmiotu, więc nie mogą zostać rozluźnione.
  // „Relik” jest zlokalizowaną nazwą przedmiotu w Cyberpunk 2077; w angielskim
  // zapisie występuje jako „Relic”. Nie dodajemy tego do globalnej tabeli aliasów,
  // bo zwykłe słowo „relic” poza kontekstem gry nie jest nazwą własną.
  const cyberpunkRelicContext = /\b(?:cyberpunk(?:\s+2077)?|johnny\s+silverhand|dexter\s+deshawn|night\s+city|engram|robert\s+john\s+linder)\b/iu.test(pl + ' ' + en);
  const missing = claimNames.filter(name => {
    if (normalizujClaim(name) === 'relik'
      && cyberpunkRelicContext
      && /\brelic\b/u.test(enNormalized)) return false;
    return !czyNazwaWlasnaWystepuje(name, enNormalized);
  });
  if (missing.length) {
    // Pełna nazwa może pochodzić z pytania, podczas gdy evidence_quote używa
    // skrótu (np. „Johnny” zamiast „Johnny Silverhand”). Skrót jest dopuszczalny
    // tylko wtedy, gdy cytat naprawdę mówi o tej samej encji: zachowane imię musi
    // w nim wystąpić i nie może po nim stać inny człon nazwy („Johnny Cash”
    // to nie „Johnny Silverhand”), a brakująca część nie może występować w cytacie.
    const quoteText = normalizujClaim(options.evidenceQuote || '');
    const retainedNames = claimNames.filter(name => !missing.includes(name) && czyNazwaWlasnaWystepuje(name, enNormalized));
    // Zachowana część musi sąsiadować z brakującą w polskim claimie.
    const adjacentRetainedNames = retainedNames.filter(retained => missing.some(name =>
      new RegExp(`\\b${normalizujClaim(retained)}\\s+${normalizujClaim(name)}\\b`, 'u').test(normalizujClaim(pl))
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
    const quoteOffset = evidenceQuote ? evidenceContext.indexOf(evidenceQuote) : -1;
    const anaphoricEn = ['who ', 'which ', 'that ', 'he ', 'she ', 'it ', 'they ', 'his ', 'her ', 'their ', 'its ']
      .some(prefix => enNormalized.startsWith(prefix));
    const prefix = quoteOffset >= 0 ? evidenceContext.slice(0, quoteOffset) : '';
    // Jedna odwrotna kreska: w literale regex „\\s” oznaczałoby dosłowny backslash + „s”,
    // przez co podział na zdania nigdy by nie zadziałał i imię z POPRZEDNIEGO zdania
    // wiązałoby się z cytatem. Imię musi stać w tym samym zdaniu co cytat.
    const sameSentencePrefix = prefix.split(/[.!?](?:\s+|$)/u).at(-1) || '';
    const normalizedPrefix = ' ' + normalizujClaim(sameSentencePrefix) + ' ';
    const missingEntitiesBound = quoteOffset >= 0
      && anaphoricEn
      && missingFromTranslation.every(name => normalizedPrefix.includes(' ' + normalizujClaim(name) + ' '));
    if (!missingEntitiesBound) {
      return { ok: false, reason: 'tłumaczenie claimu gubi nazwy własne: ' + missingFromTranslation.slice(0, 3).join(', ') };
    }
  }
  return { ok: true };
}

module.exports = { KNOWN_ENTITY_ALIAS_PATTERNS, pojeciaCrossLanguage, CAUSAL_RE, CAUSAL_EVIDENCE_RE, wyglądaNaAngielski, spojnoscTlumaczeniaClaimu, czyOgraniczenieDowodowe, normalizujClaim, tokenyClaim, liczbyDoPorownania, czyRelacjaPrzyczynowaPokrywaClaim, wyodrebnijLiczbyIDaty, wyodrebnijJednostkoweWartosci, wyodrebnijNazwyWlasne, zbudujWyroczniaNazw, zgodnoscStrukturalna, sprawdzTwardeKonflikty, sprawdzSprzecznosciSemantyczne, dopasowanieSemantyczne, sprawdzPokrycieClaimamiOdpowiedzi, czyDowodSemantyczniePokrywaClaim, tokenyPokrywajaSie, czyNazwaWlasnaWystepuje, usunEtykietyDowodow };
