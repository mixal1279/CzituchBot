# njsscan — triage i uzasadnienie wyników

## Zakres i pochodzenie raportów

- Skaner: njsscan 1.0.2 (Semgrep).
- Raport bazowy: commit `7ae2fee68091033a9971e6c9c2f2bc61c087e2ac`, workflow run `42395274148`, artifact `13583795322`.
- Weryfikacja kompletności: commit `ef07ae3072f63a3b8e76072a03878bd0bb6a8661`, workflow run `42396802761`, artifact `13584540506`.
- Weryfikacja kompletności zakończyła się: 83 findings, 0 scanner errors; JSON i SARIF zostały zwalidowane, a SARIF przesłany do Code Scanning.

Raport bazowy miał dwa timeouty: `express_xss` i `node_ssrf` w `czituch_bot.js`. Po zwiększeniu limitu Semgrep do 300 sekund pełny skan zakończył się bez błędów. To usuwa problem wykonania skanera, ale samo w sobie nie jest dowodem braku podatności.

## Aktualny raport njsscan — HEAD `c5a2508e0a8ba2bac2bb9aac9bf1a6e704c4c09b`

- Workflow run: `42417446984`; artifact JSON: `13591964827`.
- Skaner: njsscan 1.0.2 (Semgrep); **58 findings, 0 błędów skanera**.
- Wszystkie 58 dopasowań należą do reguły `regex_dos` (WARNING), w 15 plikach. Raport nie zawiera findings z `templates`.
- JSON i SARIF zostały poprawnie wygenerowane, zwalidowane i przesłane do Code Scanning.

| Plik | Findings |
|---|---:|
| `ai/claimValidation.js` | 16 |
| `ai/claim-support.js` | 9 |
| `test/ai-golden-benchmark.test.js` | 6 |
| `test/ai-routing.test.js` | 6 |
| `czituch_bot.js` | 5 |
| `ai/answer-plan.js` | 3 |
| `test/ai.test.js` | 3 |
| `ai/evidence.js` | 2 |
| `ai/lore.js` | 2 |
| `ai/core.js` | 1 |
| `ai/entities.js` | 1 |
| `ai/gameplay.js` | 1 |
| `ai/planner.js` | 1 |
| `ai/retrieval.js` | 1 |
| `ai/validator.js` | 1 |
| **Razem** | **58** |

### Interpretacja i ograniczenia

`regex_dos` w njsscan jest regułą heurystyczną. W raporcie wskazuje użycia wyrażeń regularnych w funkcjach o wielu argumentach; samo dopasowanie nie dowodzi katastroficznego backtrackingu ani kontroli wzorca przez użytkownika. Wskazania obejmują m.in. stałe wzorce intencji, pętle nad stałymi tablicami regexów oraz testowe klasyfikatory.

Przegląd kodu wykazał, że dynamiczne fragmenty regexów używane do dopasowania nazw są escapowane i ograniczane długością w helperach `ai/regex-utils.js` oraz w walidacji claimów. Wejścia głównych ścieżek pytań mają limity długości. Nie znaleziono w przejrzanych ścieżkach dynamicznego budowania wzorca z surowego tekstu użytkownika.

**Nie wyłączamy reguły i nie ukrywamy alertów.** 58 wskazań pozostaje widoczne w Code Scanning jako ostrzeżenia do triage. Nie traktujemy ich automatycznie jako 58 potwierdzonych podatności ani jako 58 udowodnionych false positives. Każdy nowy wzorzec dynamiczny lub brak limitu wejścia wymaga osobnej oceny.

## Pozostałe reguły z raportu bazowego

### `node_api_key` — 3 wskazania

Raport wskazywał wyłącznie logi wypisujące nazwy zmiennych środowiskowych i informację, czy klucz jest ustawiony; wartości kluczy nie były logowane. Mimo że nie były to sekrety, ujawniały konfigurację providerów. Logi usunięto w `czituch_bot.js`; test regresyjny znajduje się w `test/security-no-api-key-logs.test.js`.

### `node_insecure_random_generator` — 17 wskazań

Dwa użycia wpływały na rozstrzygnięcie zakładów i pojedynków wirtualnej ekonomii (`!gamble`, `!duel`). Nie klasyfikujemy ich jako kosmetycznych false positives: zostały zastąpione przez `crypto.randomInt`.

Pozostałe losowania wybierały elementy kosmetyczne/rozrywkowe i liczby prezentowane w komendach. Dla spójności i usunięcia niejednoznaczności skanera wszystkie wywołania `Math.random()` w `czituch_bot.js` zastąpiono helperami `wylosujLiczbe` i `wylosujIndeks` opartymi na `crypto.randomInt`. Testy: `test/economy-random.test.js`.

## Timeouty `express_xss` i `node_ssrf`

W raporcie bazowym obie reguły timeoutowały na `czituch_bot.js`; nie wygenerowały findingów, ponieważ analiza nie zakończyła się. Ręczny przegląd tego pliku nie wykazał aplikacji Express ani ścieżki `req.query/body/params → HTTP response`. Wywołania `fetchZTimeout` kierują do stałych endpointów lub domen Fandom ograniczonych do pojedynczej etykiety DNS i sufiksu `.fandom.com`.

To uzasadnia, dlaczego timeout nie może być traktowany jako potwierdzona podatność, ale nie zastępuje ponownego pełnego skanu. Reguły nie są wyłączone, a workflow ma fail-closed dla błędów skanera i przesyła SARIF tylko po poprawnym zakończeniu walidacji.

## Historyczne wyniki

Wcześniejsze raporty (83 findings na SHA `ef07ae3`) opisują starsze commity i nie mogą być używane jako licznik bieżącego HEAD. Po ich wygenerowaniu usunięto logi obecności kluczy i zastąpiono użycia `Math.random()` w ekonomii przez `crypto.randomInt`.

## Bieżący stan po audycie PR #131

Raport z HEAD `c5a2508e0a8ba2bac2bb9aac9bf1a6e704c4c09b` zawiera 58 ostrzeżeń `regex_dos`, 0 błędów skanera i brak findings z innych reguł. Kolejny skan po zmianie workflow musi potwierdzić wynik dla nowego HEAD; nie zakładamy, że licznik pozostanie taki sam.

