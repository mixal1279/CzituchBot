# njsscan — triage i uzasadnienie wyników

## Zakres i pochodzenie raportów

- Skaner: njsscan 1.0.2 (Semgrep).
- Raport bazowy: commit `7ae2fee68091033a9971e6c9c2f2bc61c087e2ac`, workflow run `42395274148`, artifact `13583795322`.
- Weryfikacja kompletności: commit `ef07ae3072f63a3b8e76072a03878bd0bb6a8661`, workflow run `42396802761`, artifact `13584540506`.
- Weryfikacja kompletności zakończyła się: 83 findings, 0 scanner errors; JSON i SARIF zostały zwalidowane, a SARIF przesłany do Code Scanning.

Raport bazowy miał dwa timeouty: `express_xss` i `node_ssrf` w `czituch_bot.js`. Po zwiększeniu limitu Semgrep do 300 sekund pełny skan zakończył się bez błędów. To usuwa problem wykonania skanera, ale samo w sobie nie jest dowodem braku podatności.

## Triage `regex_dos` — 63 wskazania w raporcie bazowym

Reguła njsscan sprawdza, czy wyrażenie regularne jest używane na danych wejściowych funkcji o sygnaturze dwóch lub większej liczby argumentów. Nie ocenia złożoności wzorca ani nie wymaga, aby funkcja była rzeczywistym handlerem HTTP. Dlatego obejmuje również zwykłe funkcje domenowe i testy.

W ręcznym przeglądzie wskazanych miejsc nie znaleziono dynamicznego konstruowania wzorca z surowego tekstu użytkownika ani wzorców z nieograniczonymi, zagnieżdżonymi kwantyfikatorami powodującymi wykładniczy backtracking. Poniżej podano uzasadnienie per plik; są to klasyfikacje ręczne, nie wyłączenia reguły.

| Plik | Wskazania | Uzasadnienie |
|---|---:|---|
| `ai/answer-plan.js` | 3 | Pytanie jest obcinane do 4 000 znaków; `SLOT_PATTERNS` są stałymi wzorcami. |
| `ai/claim-support.js` | 11 | Funkcja odrzuca claim powyżej 1 000 znaków i evidence powyżej 2 000; wszystkie używane wzorce są stałe. |
| `ai/claimValidation.js` | 17 | Normalizacja claimu ogranicza tekst do 12 000 znaków; wzorce są stałe. Fragmenty dynamiczne używane w dopasowaniu nazw są escapowane i ograniczone długością. |
| `ai/core.js` | 1 | Prosty prefiks `^gemini` na etykiecie providera; nie jest to wzorzec tworzony z danych użytkownika. |
| `ai/entities.js` | 1 | Stały wzorzec sprawdza końcówkę tokenu; tekst wejściowy jest normalizowany z limitem 12 000 znaków. |
| `ai/evidence.js` | 2 | Teksty claimu i cytatu są normalizowane z limitem 12 000 znaków; wzorce koncepcji i relacji są stałe. |
| `ai/gameplay.js` | 1 | Pytanie powyżej 4 000 znaków jest odrzucane; wzorce intencji są stałe. |
| `ai/lore.js` | 2 | Pytanie powyżej 4 000 znaków jest odrzucane; wzorce intencji i kontekstu są stałe. |
| `ai/planner.js` | 1 | Pytanie powyżej 4 000 znaków jest odrzucane; wzorzec anafory jest stały. |
| `ai/response.js` | 1 | Dynamiczny token ma limit 120 znaków i jest escapowany; tekst referencyjny ma limit 12 000 znaków. |
| `ai/retrieval.js` | 1 | Kontekst ma limit 4 200 znaków; tablica wzorców domen jest stała. |
| `ai/validator.js` | 1 | Claim jest normalizowany do maksymalnie 500 znaków przed kontrolą częściowej odpowiedzi. |
| `czituch_bot.js` | 5 | Wskazane dopasowania używają stałych wzorców. Nie znaleziono handlerów Express, odczytów `req.query/body/params` ani odpowiedzi `res.send/write` w tym pliku. |
| `youtube-live-discovery.js` | 1 | ID kanału jest sprawdzane jako string o dokładnej długości 24 przed stałym wzorcem. |
| `test/ai-golden-benchmark.test.js` | 6 | Wzorce służą wyłącznie klasyfikacji kontrolowanych przypadków benchmarku. |
| `test/ai-routing.test.js` | 6 | Wzorce służą wyłącznie testowej klasyfikacji pytań. |
| `test/ai.test.js` | 3 | Wzorce występują wyłącznie w testowym helperze polityki. |

**Wniosek:** wskazania `regex_dos` są false positives względem semantyki tej reguły dla przejrzanych miejsc: są to stałe wzorce na ograniczonych wejściach, nie wzorce kontrolowane przez użytkownika. Reguła pozostaje aktywna i pełny skan repozytorium jest nadal wymagany.

## Pozostałe reguły z raportu bazowego

### `node_api_key` — 3 wskazania

Raport wskazywał wyłącznie logi wypisujące nazwy zmiennych środowiskowych i informację, czy klucz jest ustawiony; wartości kluczy nie były logowane. Mimo że nie były to sekrety, ujawniały konfigurację providerów. Logi usunięto w `czituch_bot.js`; test regresyjny znajduje się w `test/security-no-api-key-logs.test.js`.

### `node_insecure_random_generator` — 17 wskazań

Dwa użycia wpływały na rozstrzygnięcie zakładów i pojedynków wirtualnej ekonomii (`!gamble`, `!duel`). Nie klasyfikujemy ich jako kosmetycznych false positives: zostały zastąpione przez `crypto.randomInt`.

Pozostałe losowania wybierały elementy kosmetyczne/rozrywkowe i liczby prezentowane w komendach. Dla spójności i usunięcia niejednoznaczności skanera wszystkie wywołania `Math.random()` w `czituch_bot.js` zastąpiono helperami `wylosujLiczbe` i `wylosujIndeks` opartymi na `crypto.randomInt`. Testy: `test/economy-random.test.js`.

## Timeouty `express_xss` i `node_ssrf`

W raporcie bazowym obie reguły timeoutowały na `czituch_bot.js`; nie wygenerowały findingów, ponieważ analiza nie zakończyła się. Ręczny przegląd tego pliku nie wykazał aplikacji Express ani ścieżki `req.query/body/params → HTTP response`. Wywołania `fetchZTimeout` kierują do stałych endpointów lub domen Fandom ograniczonych do pojedynczej etykiety DNS i sufiksu `.fandom.com`.

To uzasadnia, dlaczego timeout nie może być traktowany jako potwierdzona podatność, ale nie zastępuje ponownego pełnego skanu. Reguły nie są wyłączone, a workflow ma fail-closed dla błędów skanera i przesyła SARIF tylko po poprawnym zakończeniu walidacji.

## Status po późniejszych poprawkach

Raport z 83 findings dotyczy SHA `ef07ae3`, a nie bieżącego HEAD. Po nim usunięto logi obecności kluczy i wszystkie `Math.random()` z `czituch_bot.js`. Aktualny wynik liczbowy należy ustalić z raportu njsscan wygenerowanego dla najnowszego SHA; nie przenosić starych liczników na nowy kod.
