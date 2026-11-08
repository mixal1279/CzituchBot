'use strict';

const { resolveGameEntity } = require('./entities');
const { parseEvidenceBlocks } = require('./evidence');
const GAMELORE_DOMAIN = 'gamelore.fandom.com';
const GAMELORE_NAME = 'GameLore Wiki';

// Intencja lore opisuje pytanie o treść świata gry, a nie samo wspomnienie tytułu.
// Nie umieszczamy tu ogólnego „dlaczego”: pytania o wydajność, błędy i zakup gry
// nie mogą trafiać do RAG fabularnego tylko dlatego, że zawierają nazwę gry.
const LORE_INTENT_RE = /(?<![\p{L}\p{N}_])(?:lore|fabuł[aeęy]|histori(?:a|ę|ii|e)|kim\s+(?:[\p{L}]+\s+){0,2}(?:jest|był|była|byli)|czym\s+jest|kto\s+(?:[\p{L}]+\s+){0,2}(?:to|jest|był|była)|co\s+się\s+(?:stało|wydarzyło)|pochodzeni[ae]|backstory|kanon|canon|timeline|chronologi[ae]|zakończeni[ae]|teori[ae]|założeni[ae]|easter\s+egg|sekret(?:y|ach)?|symbolik[ai]|znaczeni[ae]|uniwersum|relacj[ae]\s+(?:między|z)|zwi[aą]zk(?:u|i|iem|ach)|konflikt(?:u|em|ach)?|motywacj[ae]|wpływ(?:u|em)?|wpłyn(?:ął|ęło|ęła|ęły)|wydarzeni(?:a|ach)\s+w\s+grze)(?![\p{L}\p{N}_])/iu;

// „Dlaczego” kwalifikuje się jako lore dopiero wtedy, gdy pytanie dotyczy
// motywacji lub zdarzenia fabularnego, a nie np. crasha czy wymagań sprzętowych.
const LORE_CAUSAL_RE = /(?<![\p{L}\p{N}_])(?:dlaczego|czemu|why)(?![\p{L}\p{N}_])/iu;
const LORE_CAUSAL_CONTEXT_RE = /(?<![\p{L}\p{N}_])(?:w\s+(?:fabule|historii|lore)|motywacj\p{L}*|powod\p{L}*|zdradził\p{L}*|zabił\p{L}*|uratował\p{L}*|opuścił\p{L}*|opuszcza\p{L}*|porzucił\p{L}*|zdradza\p{L}*|zabija\p{L}*|ratuje\p{L}*|przejmuje\p{L}*|wybiera\p{L}*|ucieka\p{L}*|poświęca\p{L}*|przejął\p{L}*|wybrał\p{L}*|uwięził\p{L}*|zniszczył\p{L}*|upadł\p{L}*|powstał\p{L}*|zaatakował\p{L}*|pomógł\p{L}*|uciekł\p{L}*|poświęcił\p{L}*|zgodził\p{L}*\s+się|pomóc|pomógł\p{L}*|zdecydował\p{L}*|pokonan\p{L}*|przegrał\p{L}*|zachorował\p{L}*|walczy\p{L}*|walczył\p{L}*|powiesił\p{L}*|popełnił\p{L}*|umarł\p{L}*|zmarł\p{L}*|zginął\p{L}*|odszedł\p{L}*|betrayed|killed|saved|left|abandoned|chose|destroyed|created|motiv(?:ation|e)|plot)(?![\p{L}\p{N}_])/iu;

// Kontekst gry może być jawny („w grze”, „uniwersum”) albo wynikać z tytułu,
// którego nie ma w lokalnym słowniku. Wykrywamy tytuły zapisane nazwą własną,
// bez utrzymywania ręcznej listy wszystkich gier.
const GAME_CONTEXT_RE = /(?<![\p{L}\p{N}_])(?:gra|gry|grze|grę|grą|gier|game|gaming|w\s+(?:tej|tejże)\s+grze|w\s+grze|z\s+gry|świat\s+gry|uniwersum|w\s+uniwersum|game\s+world|in\s+the\s+game)(?![\p{L}\p{N}_])/iu;
const GAME_TITLE_RE = /\b(?:minecraft|portal(?:\s+2)?|red\s+dead(?:\s+redemption)?(?:\s+2)?|cyberpunk(?:\s+2077)?|wied[źz]min(?:\s+3)?|witcher(?:\s+3)?|gta(?:\s+[iv1-6]+)?|grand\s+theft\s+auto|fallout(?:\s+\d+)?|skyrim|starfield|elden\s+ring|dark\s+souls|baldur[’']?s\s+gate(?:\s+3)?|the\s+last\s+of\s+us|god\s+of\s+war|assassin'?s\s+creed|fortnite|hades|half[- ]life|control)\b/i;
const GAME_TITLE_AFTER_PREPOSITION_RE = /(?<![\p{L}\p{N}_])(?:w|we|z|ze|do|dla|about|of|in|from)\s+(?:the\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’:&-]*(?:\s+(?:(?:of|the|and|&)\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’:&-]*){0,4}/u;
const GAME_TITLE_AFTER_LORE_RE = /(?:^|[^\p{L}\p{N}_])(?:lore|fabuł[aeęy]|histori[aeęy]|chronologi[ae]|zakończeni[ae]|teori[ae]|świata|uniwersum)\s+(?:gry\s+)?(?:(?:o|of|about)\s+)?(?:the\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’:&-]*(?:\s+(?:(?:of|the|and|&)\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’:&-]*){1,4}/u;
const GAME_TITLE_BEFORE_LORE_RE = /(?:^|[^\p{L}\p{N}_])(?:the\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’:&-]*(?:\s+(?:(?:of|the|and|&)\s+)?[\p{Lu}\p{N}][\p{L}\p{N}'’:&-]*){1,4}\s+(?:lore|fabuł[aeęy]|histori[aeęy]|chronologi[ae]|uniwersum)(?![\p{L}\p{N}_])/u;

function czyMaKontekstGry(pytanie) {
  const p = String(pytanie || '').trim();
  if (!p || p.length > 4000) return false;
  const resolved = resolveGameEntity(p);
  const dopasowaniePoPrzyimku = p.match(GAME_TITLE_AFTER_PREPOSITION_RE);
  const tytulPoPrzyimku = dopasowaniePoPrzyimku?.[0]
    ?.replace(/^(?:w|we|z|ze|do|dla|about|of|in|from)\s+(?:the\s+)?/i, '').trim();
  const bezpiecznyTytulPoPrzyimku = Boolean(tytulPoPrzyimku && (
    tytulPoPrzyimku.split(/\s+/).length >= 2
    || /[-\d]/.test(tytulPoPrzyimku)
    || GAME_TITLE_RE.test(tytulPoPrzyimku)
  ));
  return GAME_CONTEXT_RE.test(p)
    || GAME_TITLE_RE.test(p)
    || bezpiecznyTytulPoPrzyimku
    || GAME_TITLE_AFTER_LORE_RE.test(p)
    || GAME_TITLE_BEFORE_LORE_RE.test(p)
    || Boolean(resolved && resolved.resolution !== 'deterministic_ambiguous');
}

function czyPytanieOLore(pytanie, domeny = null) {
  const p = String(pytanie || '').trim();
  if (!p || p.length > 4000) return false;

  const resolved = resolveGameEntity(p);
  const loreIntent = LORE_INTENT_RE.test(p)
    || (LORE_CAUSAL_RE.test(p) && LORE_CAUSAL_CONTEXT_RE.test(p))
    || (resolved && /(?<![\p{L}\p{N}_])(?:kim|kto|histori\p{L}*|lore|pochodzeni\p{L}*|kanon|timeline|zwi[aą]zk\p{L}*|relacj\p{L}*|konflikt\p{L}*|motywacj\p{L}*|wpływ\p{L}*|wpłyn\p{L}*)(?![\p{L}\p{N}_])/iu.test(p));
  if (!loreIntent) return false;

  const gamingDomain = Array.isArray(domeny) && domeny.some(d =>
    /(?:minecraft\.wiki|gamelore\.fandom\.com|fandom\.com|ign\.com|gamespot\.com|pcgamer\.com|eurogamer|rockstargames\.com|thewitcher\.com|bandainamco|playstation\.com|naughtydog\.com|baldursgate3\.game|larian\.com|fortnite\.gg)/i.test(String(d))
  );
  return czyMaKontekstGry(p) || gamingDomain
    || Boolean(resolved && resolved.resolution !== 'deterministic_ambiguous')
    || Boolean(resolved && ['Ellie', 'Joel Miller'].includes(resolved.name)
      && /(?<![\\p{L}\\p{N}_])(?:kim|kto)(?![\\p{L}\\p{N}_])/iu.test(p))
    || Boolean(resolved && LORE_CAUSAL_RE.test(p) && LORE_CAUSAL_CONTEXT_RE.test(p));
}

function normalizujHost(wartosc) {
  const surowe = String(wartosc || '').trim().toLowerCase();
  if (!surowe) return '';
  try {
    return new URL(surowe).hostname.toLowerCase();
  } catch (_) {
    return surowe
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/[\/?#].*$/, '')
      .replace(/:\d+$/, '')
      .toLowerCase();
  }
}

function dodajGameLoreDomenę(domeny) {
  const lista = Array.isArray(domeny) ? [...domeny] : [];
  const maGameLore = lista.some((d) => normalizujHost(d) === GAMELORE_DOMAIN);
  if (!maGameLore) lista.unshift(GAMELORE_DOMAIN);
  return lista;
}

function wytnijAtrybucjeGameLoreWszystkie(tekst, dozwoloneSourceIds = null) {
  const t = String(tekst || '').slice(0, 120000);
  const dozwolone = dozwoloneSourceIds instanceof Set
    ? dozwoloneSourceIds
    : Array.isArray(dozwoloneSourceIds)
      ? new Set(dozwoloneSourceIds.map(String))
      : null;
  const wyniki = [];
  const widzianeUrl = new Set();

  // Parser ignoruje markery SOURCE osadzone wewnątrz niezaufanej treści strony.
  for (const source of parseEvidenceBlocks(t)) {
    if (dozwolone && !dozwolone.has(source.sourceId)) continue;
    if (!source.url) continue;

    try {
      const parsed = new URL(source.url);
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== GAMELORE_DOMAIN) continue;
      const url = parsed.toString();
      if (widzianeUrl.has(url)) continue;
      widzianeUrl.add(url);
      const title = String(source.title || 'artykuł').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
      wyniki.push({
        sourceId: source.sourceId,
        name: GAMELORE_NAME,
        title: title || 'artykuł',
        url,
        license: 'CC BY-SA',
      });
    } catch (_) {
      continue;
    }
  }
  return wyniki;
}

function wytnijAtrybucjeGameLore(tekst, dozwoloneSourceIds = null) {
  return wytnijAtrybucjeGameLoreWszystkie(tekst, dozwoloneSourceIds)[0] || null;
}

module.exports = {
  GAMELORE_DOMAIN,
  GAMELORE_NAME,
  czyPytanieOLore,
  czyMaKontekstGry,
  dodajGameLoreDomenę,
  wytnijAtrybucjeGameLore,
  wytnijAtrybucjeGameLoreWszystkie,
};
