# Plan refaktoru systemu AI (strangler fig, cel: live benchmark + limity API)

**Motywacja:** benchmark live i limity dostawców — nie „estetyka kodu".
**Metoda:** inkrementalna ekstrakcja z monolitu do `ai/`, bez rewrite'u, testy zielone po każdym kroku.

---

## 0. Diagnoza — gdzie naprawdę jest dług

| Obszar | Stan | Wpływ na benchmark/limity |
|---|---|---|
| `ai/` (35 modułów, ~5,3k linii) | Dobry: deterministyczny `core.js`, kontrakty, 444 zielone testy | Niski — tu refaktor nie pomoże |
| `czituch_bot.js` (8 622 linii, ~190 funkcji) | Orkiestracja AI (~linie 1086–4410) wymieszana z integracjami platform | **Wysoki** — patrz niżej |
| `ai/fallback.js` | Ma już `GENERATION_FALLBACK_CHAIN`, klasyfikatory błędów, quota-cooldowny | Sterownik istnieje, ale pętla używająca go siedzi inline w `zapytajAI` |

Konkretne problemy znalezione podczas przeglądu (każdy z nich to ryzyko dla wyniku benchmarku):

1. **`zarezerwujSlotWalidatora` zadeklarowana dwukrotnie** (linie 1634 i 1653 `czituch_bot.js`) — niemal identyczne kopie, druga po cichu nadpisuje pierwszą. Klasyczny objaw kopiuj-wklej-ewoluuje: następna edycja jednej z kopii rozjedzie je niezauważenie, a rezerwacja slotów walidatora to serce budżetu `maxValidatorow`.
2. **Cztery niemal bliźniacze walidatory dostawców**: `walidujOdpowiedzGeminiModel` (1672–1898), `walidujOdpowiedzOpenRouter` (1948–2085), `walidujOdpowiedzGroq` (2086–2214), `walidujOdpowiedzXKiro` (2215–2349). Każdy osobno obsługuje quota, `Retry-After`, circuit-breaker, timeout (46 odwołań do logiki quota w monolicie). Poprawka limitów w jednym nie propaguje się do pozostałych — a benchmark ustawia `AI_PROVIDER_QUOTA_COOLDOWN_MS=1800000` i polega na tym, że zachowanie jest spójne.
3. **`zapytajAI` ma ~1030 linii** (2770–3804) z pięcioma zagnieżdżonymi fallbackami generacji (`zapytajGeminiFallback`, `zapytajGeminiLiteFallback`, `zapytajOpenRouterFallback`, `zapytajXKiro`, `zapytajGlowny`) i pętlą naprawczą. To tu najczęściej wpychane są „poprawki benchmarkowe", przez co funkcja rośnie i coraz trudniej przewidzieć jej zachowanie.
4. **257 wywołań `console.log/warn`** zamiast strukturalnych metryk — diagnostyka „dlaczego próba padła" wymaga ręcznego czytania logów; `ai/metrics.js` istnieje, ale pokrywa tylko część ścieżki.

Wniosek: **system AI nie potrzebuje przeprojektowania — potrzebuje wyniesienia orkiestracji z monolitu do `ai/`, w kolejności od miejsc najbliższych limitom API.**

---

## 1. Zasady prowadzenia refaktoru

1. **Jeden moduł = jeden PR.** Ekstrakcja bez zmiany zachowania: przenosimy kod, wstrzykujemy zależności (wzorzec fabryki `createXxx(deps)`, jak `createTavilySearch` / `createGroqCompletion`).
2. **`npm test` (444 testy) + `npm run benchmark:offline` zielone po każdym PR.** Żaden krok nie zmienia wartości domyślnych flag.
3. **Po fazach 1–3: ręczny live benchmark** (workflow `AI live benchmark`, seed 0 i seed > 0) jako bramka przed fazą kolejną. Offline benchmark weryfikuje kod, live — efekt.
4. **Stare ścieżki importu przez okres przejściowy:** `czituch_bot.js` wymaga z `ai/`, a blok eksportów dla testów na dole pliku (linia ~8596) aktualizujemy w tym samym PR.
5. **Nie dotykamy w trakcie ekstrakcji:** treści promptów, progów walidacji, łańcucha fallbacków, limitów z `ai/limits.js`. To są wartości strojone benchmarkiem — ich zmiana musi być osobnym PR z osobnym benchmarkiem, inaczej nie odróżnimy regresji refaktoru od regresji strojenia.

---

## 2. Fazy (kolejność wg odległości od problemów z limitami)

### Faza 1 — `ai/quota.js`: jedno miejsce na limity dostawców ⭐ najwyższy priorytet
**Wyciągnąć:** `zarezerwujRequest120B`, `zablokuj120BGlobalnie`, `model120BGlobalQuotaSnapshot`, `resetModel120BGlobalQuotaForTests` (4276–4326), `validatorBreakerIsOpen`, `recordValidatorTransportResult` (1899–1934), `geminiGenerationCooldownUntil` + `ustawGeminiGenerationCooldown` + `wyczyscGeminiGenerationCooldown` (1935–1947).
**Scalić z:** odpowiednikami w `ai/fallback.js` (`markProviderQuota`, `isProviderQuotaBlocked`, `quotaCooldownMsFromError`, `shouldOpenQuotaCircuit`).
**Efekt biznesowy:** cooldowny, circuit-breakery i okno 120B mają dziś 2 domy implementacji (monolit + `ai/fallback.js`). Jedna implementacja = przewidywalne zużycie limitów w benchmarku i produkcji, oraz możliwość testów jednostkowych okien czasowych bez mockowania monolitu.

### Faza 2 — `ai/providers/`: jeden kontrakt walidatora/generatora per dostawca
**Wyciągnąć:** cztery walidatory (liniowanie w tabeli wyżej) + pięć fallbacków generacji z `zapytajAI` (3331–3660) do modułów `ai/providers/groq.js`, `gemini.js`, `openrouter.js`, `xkiro.js` z wspólnym `createProviderValidator({ endpoint, model, auth, timeoutMs, schema })`.
**Efekt biznesowy:** poprawki typu „Retry-After z nagłówka ma pierwszeństwo" (opisane w docs/ai-flags.md) wprowadza się raz. To bezpośrednio adresuje scenariusz „benchmark pada, bo jeden dostawca inaczej liczy cooldown".
**Uwaga:** usunąć przy okazji duplikat `zarezerwujSlotWalidatora` — przenosimy jedną wersję do `ai/providers/`.

### Faza 3 — `ai/validator-orchestrator.js`: kolejność i budżet walidacji
**Wyciągnąć:** `walidujOdpowiedzAI` (2358–2373), `walidujOdpowiedzAIBezCache` (2384–2628), `czyWartoDrugaOpinieWalidatora` (2374–2383), `zbudujPromptWalidatora` (1606–1633), `zastosujDeterministyczneGuards` (387–438), `zarezerwujSlotWalidatora` z Fazy 2.
**Efekt biznesowy:** orkiestracja „który walidator, w jakiej kolejności, za czyń budżetu" przestaje być rozproszona po 300 liniach monolitu. To najdroższa faza merytorycznie — tu siedzi logika drugiej opinii i rezerwacji slotów, czyli to, co decyduje o `validator_reject` vs `accepted` w benchmarku.

### Faza 4 — `ai/generation.js`: pętla generacji sterowana łańcuchem fallbacków
**Wyciągnąć:** resztę `zapytajAI` — fazę generacji, pętlę naprawczą i `uzupelnijDanePoValidatorze` (3251–3330). Docelowo pętla iteruje po `GENERATION_FALLBACK_CHAIN` z `ai/fallback.js` zamiast wywoływać zagnieżdżone funkcje po nazwie.
**Efekt biznesowy:** dodanie/odjęcie dostawcy = wpis w łańcuchu, nie nowa zagnieżdżona funkcja. Marnotrawstwo prób (wasted generations = szybsze wyczerpanie limitu w benchmarku) staje się widoczne w jednym miejscu.
**Po tej fazie `zapytajAI` w monolicie zostaje jako cienki adapter** (~150 linii): sanityzacja, persona, pamięć użytkownika, wywołanie pipeline'u.

### Faza 5 — `ai/datasources/`: adaptery danych zewnętrznych (izolacja latencji)
**Wyciągnąć:** HLTB (1205–1552), IGDB (1092–1172), Steam (1327–1348), receptury MC (219–378), wiki (4829–4842). Wspólny `createDataSource({ fetch, timeoutMs })` oparty o istniejący `fetchZTimeout`.
**Efekt biznesowy:** przypadki benchmarkowe o czasach grania zależą od HLTB + codepotatoes; osobne moduły = osobne timeouty i testy fixture'owe bez sieci, mniej „wiszących" żądań zjadających 40-s budżet żądania.

### Faza 6 (opcjonalna) — persony i scoping retrieval
`pobierzWiedzeBilly/Edzzi/Angie` + prompty person → `ai/personas.js`; `zakresTavilyDlaPytania`/`domenyDlaPytania`/`wybierzDomenyDlaPytania` (999–1091) → `ai/retrieval-scope.js`. Niższy priorytet: nie obciążają limitów generatora.

**Poza zakresem planu** (osobna decyzja, nie blokuje benchmarku): integracje platform (YouTube/Kick/Twitch/Trello/ekonomia, ~4,5k linii) — mogą zostać w `czituch_bot.js` albo pójść do `platforms/` po zakończeniu faz 1–6.

---

## 3. Szybkie wygrane do zgrania w trakcie (nie wymagają osobnego PR)

- Usunięcie duplikatu `zarezerwujSlotWalidatora` (Faza 2, trivial).
- Logi providerów przez `ai/metrics.js` (requestState już ma `recordTiming` — użyć go zamiast `console.warn` przy odrzuceniach budżetu). Ułatwi diagnozę „który dostawca zjadł budżet".
- Blok eksportów testowych na dole `czituch_bot.js` (linia 8596) przenosić do eksportów nowych modułów — zmniejsza powierzchnię „sekretnych" zależności testowych.

## 4. Metryki sukcesu

| Miara | Baseline | Cel po fazach 1–4 |
|---|---|---|
| `czituch_bot.js` | 8 622 linii | < 5 000 (AI w całości w `ai/`) |
| Live benchmark (`AI_BENCHMARK_REQUIRE_PERFECT=1`, seed 0 i 2 różne seedy) | bieżący stan repo | nie gorszy niż baseline na tym samym seedzie |
| Zużycie wywołań modeli na przypadek (`modelCalls` w podsumowaniu requestu) | z logów live benchmarku | brak wzrostu; docelowo spadek po Fazie 2 |
| Duplikaty logiki quota | 2 implementacje | 1 (`ai/quota.js`) |

## 5. Czego świadomie NIE robić

- **Rewrite'u / „AI system v26"** — 444 zielone testy i strojenie pod benchmark to kapitał; unieważnienie go kosztuje tygodnie.
- Zmiany progów walidacji i treści promptów w PR-ach ekstrakcyjnych — osobne PR-y, osobne benchmarki.
- Paralelnego utrzymywania starej i nowej ścieżki poza okresem przejściowym jednego PR — feature flagi per faza to tu nadmiarowy koszt; granicą bezpieczeństwa są testy + offline benchmark + live benchmark między fazami.
