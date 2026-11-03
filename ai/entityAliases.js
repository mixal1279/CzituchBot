'use strict';

// Kanoniczne encje z jawnymi aliasami PL/EN. Jedna grupa = jedna nazwa wlasna,
// rozpoznawana jako calosc (a nie jako luzne tokeny z wielkiej litery).
// Dopisujac nowa grupe, podawaj wylacznie nazwy potwierdzone w zrodlach gry;
// nie zgaduj tlumaczen. Nazwa nieobecna w tej tabeli nadal podlega pelnej,
// twardej kontroli w dowodzie.
const ENTITY_ALIAS_GROUPS = Object.freeze([
  // GTA V: polski tytul misji „Prolog” odpowiada angielskiemu „Prologue”.
  { canonical: 'prologue', names: ['Prologue', 'Prolog'] },
  // Skyrim: Dovahkiin is the in-world name for the Dragonborn; preserve both
  // the common spelling and the canonical dragon-language form found in sources.
  { canonical: 'dragonborn', names: ['Dragonborn', 'Dovahkiin', 'Laat Dovahkiin'] },
  // The Witcher 3: these Polish names identify the Feline Armor/gear item,
  // not a separate School of the Cat faction entity.
  // Minecraft: End City (miasto) i End Ship (statek) sa odrebnymi encjami.
  // Nie laczymy ich aliasow — walidator ma wykrywac zamiane miasta na statek i odwrotnie.
  { canonical: 'end city', names: ['End City', 'End Cities', 'Miasto Endu', 'Miasta Endu', 'Miasto Kresu', 'Miasta Kresu'] },
  { canonical: 'end ship', names: ['End Ship', 'End Ships', 'Statek Endu', 'Statki Endu', 'Statek Kresu', 'Statki Kresu'] },
  // Zweryfikowane odpowiedniki nazw z lokalizacji gier. Trzymajmy tu tylko
  // encje, dla ktorych mapowanie PL/EN jest jednoznaczne; nie dopisujemy
  // nazw opisowych ani tlumaczen zgadywanych na podstawie samego kontekstu.
  { canonical: 'wild hunt', names: ['Wild Hunt', 'Dziki Gon'] },
  // Zweryfikowane tytuly zadan Wiedzmina 3 w lokalizacji PL/EN.
  { canonical: 'family matters', names: ['Family Matters', 'Sprawy rodzinne'] },
  { canonical: 'hunting a witch', names: ['Hunting a Witch', 'Polowanie na czarownicę', 'Polowanie na czarownice'] },
  { canonical: 'wandering in the dark', names: ['Wandering in the Dark', 'Wędrowanie w ciemności'] },
  { canonical: 'ladies of the wood', names: ['Ladies of the Wood', 'Damy lasu'] },
  { canonical: 'bloody baron', names: ['Bloody Baron', 'Krwawy Baron', 'Baron Krwawy'] },
  // Zweryfikowane nazwy przedmiotow i lokacji z Wiedzmina 3 (PL/EN).
  { canonical: 'feline armor', names: ['Feline Armor', 'Feline Gear', 'Feline Gear Set', 'Cat School Gear', 'Zbroja Szkoły Kota', 'Zbroja wiedźmińskiego cechu kota', 'Rynsztunek Szkoły Kota', 'Rynsztunek Kociej Szkoły'] },
  { canonical: 'temple isle', names: ['Temple Isle', 'Wyspa Świątynna'] },
  { canonical: 'eye of nehaleni', names: ['Eye of Nehaleni', 'Oko Nehaleni'] },
  // Keep the Skyrim item separate from Dragonrend; only the English item name is unambiguous.
  { canonical: 'dragonbane', names: ['Dragonbane'] },
  { canonical: "alduin's wall", names: ['Alduins Wall'] },
  // „Smocza Zguba” is ambiguous in Skyrim: it can refer to the Dragonbane sword,
  // while Dragonrend is a shout. Do not map the localized phrase globally to the
  // shout, or evidence about the sword is falsely rejected as missing Dragonrend.
  { canonical: 'dragonrend', names: ['Dragonrend'] },
  { canonical: 'cathedral of dragon communion', names: ['Cathedral of Dragon Communion', 'Katedra Smoczej Komunii', 'Katedra Komunii Smoka'] },
  { canonical: 'greatsword', names: ['Greatsword', 'Wielki Miecz'] },
  { canonical: 'eternal fire', names: ['Eternal Fire', 'Wieczny Ogień', 'Wiecznego Ognia', 'Wiecznym Ogniem', 'Wiecznemu Ogniowi'] },
]);

const DIACRITIC_CLASSES = { a: 'a\u0105', c: 'c\u0107', e: 'e\u0119', l: 'l\u0142', n: 'n\u0144', o: 'o\u00f3', s: 's\u015b', z: 'z\u017a\u017c' };

// Token nazwy -> wzorzec odporny na brak polskich znakow (tekst po normalizacji)
// i na polska odmiane (zamknieta lista koncowek, tylko dla tokenow >= 4 znakow,
// zeby „Miecz” nie lapal np. „Mieczyk”).
const ENDINGS = 'iego|iemu|iej|ich|imi|ych|ymi|ego|emu|owi|ami|ach|iem|ie|[o\u00f3]w|om|em|ym|im|ej|[a\u0105]|[e\u0119]|[o\u00f3]|u|y|i';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripDiacritics(value) {
  return String(value || '').toLocaleLowerCase('pl-PL').replace(/\u0142/g, 'l')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function letterClass(ch) {
  const cls = DIACRITIC_CLASSES[ch];
  return cls ? `[${cls}]` : escapeRegex(ch);
}

function tokenPattern(token) {
  const base = stripDiacritics(token).replace(/[^a-z0-9]/g, '');
  if (!base) return null;
  if (base.length < 4) return [...base].map(letterClass).join('');
  const last = base[base.length - 1];
  // Rzeczownik na samogloske zmienia koncowke (Twierdza -> Twierdze, Zeta -> Zety),
  // wiec odcinamy ostatnia litere i wymagamy jednej z koncowek z listy.
  if ('aeoyi'.includes(last)) {
    const stem = [...base.slice(0, -1)].map(letterClass).join('');
    // Rzeczowniki zenskie na „-ja” (zbroja, szyja, aleja, armia, historia…) w dopelniaczu/
    // celowniku/miejscowniku l.poj. traca spolgloske „j” przed miekka koncowka „i”
    // (zbroja -> zbroi, nigdy „zbroji”) — regularna koncowka „i” dociealaby tylko „a” i
    // zostawilaby „j”, dajac bledna forme. Pozostale koncowki („zbroja”, „zbroje”…)
    // zachowuja „j” normalnie i ida zwykla sciezka.
    if (last === 'a' && base[base.length - 2] === 'j') {
      const stemBezJ = [...base.slice(0, -2)].map(letterClass).join('');
      const endingsBezI = ENDINGS.split('|').filter(ending => ending !== 'i').join('|');
      return `(?:${stem}(?:${endingsBezI})|${stemBezJ}i)`;
    }
    return `${stem}(?:${ENDINGS})`;
  }
  return `${[...base].map(letterClass).join('')}(?:${ENDINGS})?`;
}

function buildAliasPattern(names) {
  const alternatives = (Array.isArray(names) ? names : [])
    .map(name => String(name || '').trim().split(/\s+/u).map(tokenPattern).filter(Boolean))
    .filter(tokens => tokens.length)
    .map(tokens => tokens.join('[\\s\\-]+'));
  if (!alternatives.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

function buildEntityAliasPatterns(groups = ENTITY_ALIAS_GROUPS) {
  return (Array.isArray(groups) ? groups : [])
    .map(group => ({ canonical: stripDiacritics(group?.canonical).replace(/\s+/g, ' ').trim(), pattern: buildAliasPattern(group?.names) }))
    .filter(entry => entry.canonical && entry.pattern);
}

module.exports = { ENTITY_ALIAS_GROUPS, buildAliasPattern, buildEntityAliasPatterns };
