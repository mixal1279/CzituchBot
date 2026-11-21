# Audyt dynamicznych wyrażeń regularnych

Data przeglądu: 2026-11-07  
Zakres: `czituch_bot.js`, `ai/`, `youtube-live-discovery.js` oraz miejsca wskazane przez njsscan `regex_dos`.

## Zasady

- Dane użytkownika nie mogą trafiać do źródła `RegExp` bez escapowania.
- Dynamiczny fragment regexu ma limit długości.
- Teksty poddawane dopasowaniu mają limity wejścia.
- Granice nazw używają Unicode property escapes (`\p{L}`, `\p{N}`) zamiast ASCII-only `\b`, gdy istotne są polskie znaki.
- Nie używamy statycznych list gier do rozstrzygania relacji IGDB; wzorce aliasów służą tylko do ekstrakcji encji.

## Miejsca konstrukcji regexów

| Miejsce | Źródło wzorca | Ocena |
|---|---|---|
| `ai/regex-utils.js` — `ucieknijRegex` | Fragment z danych wejściowych | Bezpieczne: escapowanie metaznaków, limit 120 znaków, jawny błąd po przekroczeniu limitu. |
| `ai/regex-utils.js` — `utworzRegexPelnejNazwy` | Escapowany fragment z powyższego helpera | Bezpieczne: limit 120 i granice Unicode; pusty fragment daje regex, który nigdy nie pasuje. |
| `czituch_bot.js` — odpowiedzi HLTB | Nick użytkownika | Bezpieczne: nick jest escapowany przez `ucieknijRegex`; limit 120. |
| `ai/claimValidation.js` — `czyNazwySasiaduja` | Dwie nazwy z danych claimu | Bezpieczne: oba fragmenty są escapowane, każdy ma limit 120; tekst jest normalizowany i ograniczany do 12 000 znaków. |
| `ai/claimValidation.js` — `TYTULY_GIER` | Alias z `ai/entities.js` | Bezpieczne: źródło jest statyczną tabelą aliasów; każdy token jest escapowany przed wstawieniem do wzorca. |
| `ai/claimValidation.js` — wzorce encji | `KNOWN_ENTITY_ALIAS_PATTERNS` i `ai/entityAliases.js` | Bezpieczne: wzorce pochodzą z kodu/tabel aliasów, nie z tekstu użytkownika. Tabela generowana ma limity liczby grup, aliasów, długości i tokenów. |
| `ai/response.js` — `zawieraTokenTwardy` | Token faktograficzny z odpowiedzi | Bezpieczne: token jest obcinany do 120 znaków i escapowany; tekst źródłowy powyżej 12 000 znaków jest odrzucany. |
| `youtube-live-discovery.js` — `parseAssignedJson` | Nazwa zmiennej | Bezpieczne: nazwa jest wybierana wyłącznie z dwóch stałych wartości (`ytInitialData`, `ytInitialPlayerResponse`); HTML ma limit 512 KiB. |
| `ai/router.js` — `detectFreshness` | Stałe fragmenty `S`/`E` i stałe alternatywy | Bezpieczne: żaden fragment regexu nie pochodzi z pytania; pytanie jest tekstem dopasowania. |
| `ai/policy.js` — `re(src)` | Stałe wzorce polityki przekazywane jako literały | Bezpieczne: `src` nie jest wejściem użytkownika. |
| `ai/answer-sanitize.js` | `LABEL_SOURCE` | Bezpieczne: stały wzorzec etykiet, bez dynamicznego tekstu użytkownika. |

## Regexy statyczne i ograniczenia wejścia

- `ai/answer-plan.js`: pytanie jest ograniczane do 4 000 znaków.
- `ai/claim-support.js`: claim do 1 000 znaków, evidence do 2 000 znaków.
- `ai/claimValidation.js`: normalizacja claimu do 12 000 znaków; fragmenty nazw w dynamicznym regexie do 120 znaków.
- `ai/entities.js`: tekst encji do 12 000 znaków.
- `ai/response.js`: token do 120 znaków, tekst referencyjny do 12 000 znaków.
- `ai/validator.js`: claim normalizowany do 500 znaków przed kontrolą częściowej odpowiedzi.
- `youtube-live-discovery.js`: źródłowy HTML do 512 KiB; nazwy zmiennych ograniczone do dwóch stałych.

Wzorce w `ai/router.js`, `ai/policy.js`, `ai/answer-sanitize.js` i tabelach domenowych są stałe. Pytanie lub dowód są argumentem `.test()`, nigdy źródłem regexu.

## Granice Unicode

Nazwy i tokeny, dla których polskie znaki mają znaczenie, używają lookaroundów z `\p{L}` i `\p{N}`. Nie używamy `\b` jako granicy polskiego słowa, ponieważ JavaScriptowe `\b` opiera się na klasie znaków ASCII i może błędnie rozdzielać słowa zawierające diakrytyki.

## ReDoS

W przejrzanych miejscach nie znaleziono dynamicznego regexu budowanego z surowego wejścia użytkownika ani wzorca z nieograniczonymi, zagnieżdżonymi kwantyfikatorami o wykładniczym backtrackingu. Wejścia są ograniczone przed dopasowaniem, a dynamiczne fragmenty są escapowane.

Ostrzeżenia njsscan `regex_dos` są szerokimi dopasowaniami semantycznymi na wywołaniach `.test()` w funkcjach z wieloma argumentami; obejmują też funkcje domenowe i testy, nie tylko handlery HTTP. Uzasadnienie raportu bazowego znajduje się w `docs/security/njsscan-triage.md`. Reguła pozostaje aktywna — nie jest ignorowana ani wyłączona.

## Wynik skanu bieżącego HEAD

Dla `c5a2508e0a8ba2bac2bb9aac9bf1a6e704c4c09b` njsscan 1.0.2 wygenerował 58 wskazań `regex_dos` w 15 plikach i 0 błędów skanera (workflow run `42417446984`). Nie ma findings z innych reguł ani z sekcji `templates`.

Wskazania obejmują także stałe wzorce językowe, pętle nad tablicami wzorców i testowe klasyfikatory. To szerokie ostrzeżenie heurystyczne, a nie automatyczny dowód ReDoS. Nie wyłączono reguły ani nie dodano globalnego suppressiona. Szczegółowy rozkład plików znajduje się w `docs/security/njsscan-triage.md`.

## Testy regresyjne

- `test/ai-regex-utils.test.js`: escapowanie metaznaków, limit długości, polskie granice Unicode, puste wejście.
- `test/entity-alias-tables.test.js`: limity generowania wzorców aliasów.
- `test/ai-game-relations.test.js`: rozróżnianie tytułów i relacji bez dopasowania prefiksowego.
- `test/economy-random.test.js`: niezależny test generatora losowego, poza zakresem regexów.
