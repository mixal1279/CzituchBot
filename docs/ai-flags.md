# Konfiguracja systemu AI

Wszystkie ustawienia są opcjonalne, chyba że dana integracja jest wymagana przez uruchamiany moduł. Sekrety przechowuj w lokalnym `.env` lub w GitHub Actions Secrets — **nigdy nie commituj prawdziwych kluczy**.

## Modele i routing

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `AI_QUERY_REWRITE_MODEL` | `openai/gpt-oss-20b` | Model do przepisywania zapytań wyszukiwawczych. |
| `AI_VALIDATOR_MODEL` | `openai/gpt-oss-20b` | Domyślny model walidatora Groq; używany też jako fallback dla modelu walidatora OpenRouter, jeśli nie ustawiono osobnej zmiennej. |
| `AI_WEB_SEARCH_MODEL` | `gemini-3.8-flash` | Model używany do web search/groundingu. |
| `AI_GENERATOR_MODEL` | `openai/gpt-oss-120b` | Główny model generujący odpowiedź. |
| `AI_GEMINI_MODEL` | `gemini-3.8-flash` | Model Gemini dla generowania/fallbacku. |
| `AI_GEMINI_LITE_MODEL` | `gemini-3.5-flash-lite` | Lekki model Gemini. |
| `AI_GEMINI_VALIDATOR_MODEL` | `gemini-3.5-flash-lite` | Model Gemini do walidacji; można go zmieniać na potrzeby porównania benchmarków. |
| `OPENROUTER_VALIDATOR_MODEL` | wartość `AI_VALIDATOR_MODEL` | Osobny model walidatora OpenRouter. |
| `OPENROUTER_GENERATOR_MODEL` | wartość `AI_GENERATOR_MODEL` | Osobny model generatora OpenRouter. |
| `XKIRO_MODEL` | `qwen/qwen3.5-397b-a17b:free` | Model walidatora xKiro i generatora w łańcuchu fallbacków, jeśli `XKIRO_API_KEY` jest skonfigurowany. |
| `AI_VALIDATOR_GROQ` | włączona | Ustaw `0`, aby wyłączyć ścieżkę walidatora Groq. |

## Limity i cache

Domyślny budżet pojedynczego żądania AI jest współdzielony przez generowanie, walidację i wyszukiwanie: 40 s czasu ściennego, 12 wywołań modeli, maksymalnie 6 generacji łącznie (do 5 początkowych i do 4 naprawczych), 4 sloty walidatora i 3 wyszukiwania Tavily. Limity faz są górnymi granicami, nie sumują się ponad limit 6 generacji. Wywołania Groq nie wykonują ukrytych retry SDK — ponowienia i przełączanie dostawców kontroluje wspólny budżet oraz łańcuch fallbacków. Główne wyszukiwanie Tavily i jego źródła uzupełniające dzielą jeden limit czasu. Próba naprawcza startuje tylko wtedy, gdy pozostało co najmniej 13,5 s: 3 s minimalnego czasu generowania i 10,5 s rezerwy na walidację/fallback.

Walidacja claimów jest wykonywana lokalnie po odpowiedzi modelu. Oprócz struktury JSON sprawdzane są źródła i dosłowne cytaty, liczby i jednostki, negacja, nazwy własne oraz znane sprzeczności zdarzeń. Jeśli model dostarcza `claim_en`, tłumaczenie musi zachować znane relacje przyczynowe i kierunek redukcji/ochrony; klauzule celu (np. „aby”, „in order to”, „so that”) same w sobie nie są traktowane jako przyczynowość. Schemat JSON ogranicza format, ale nie zastępuje tych kontroli semantycznych.

Plan odpowiedzi ma osobne wymagania dotyczące kompletności. Gdy pytanie zawiera kilka rozpoznanych klauzul, kontrola kompletności wymaga śladów treści z każdej z nich, a nie tylko spełnienia jednego globalnego slotu. Dla pytań o lore odpowiedź musi zachować kontekst encji z pytania lub rozpoznanej gry; klauzula celu może wyjaśniać „dlaczego”, ale nie zastępuje instrukcji krok po kroku. Końcowa kontrola twardych faktów porównuje liczby i jednostki z treścią źródeł, nie z samym tytułem ani URL-em. Te same deterministyczne bramki są wykonywane również po naprawie kompletności odpowiedzi. Dodatkowo istnieje wąska lista heurystyk dla wybranych fałszywych wyjaśnień przejęcia kontroli przez Wheatleya w Portal 2; nie zastępuje ona walidacji claimów i cytatów.

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `AI_ALLOW_PARTIAL_ANSWERS=1` | wyłączona | Pozwala zwrócić wyłącznie claimy z potwierdzonym dowodem po częściowym odrzuceniu odpowiedzi. Nie omija walidacji cytatów, dat/liczb, negacji, ID źródeł ani formatu. Włączaj dopiero po pomiarze fałszywych akceptacji. |
| `AI_GEMINI_EXTRACT=1` | wyłączona | Używa Gemini Grounding wyłącznie do znalezienia adresów, a treść pobiera przez Tavily Extract. Bez tej opcji segmenty odpowiedzi Gemini nie są traktowane jako tekst strony ani dowód; wymagane jest inne źródło treści, np. Exa. |
| `AI_QUALITY_ALL_PROFILES=1` | wyłączona | Uruchamia bramkę jakości także dla profili `simple`, `comparison` i `technical`; może zwiększyć liczbę odrzuceń. |
| `AI_GROQ_VALIDATOR_MAX_EVIDENCE_CHARS` | `12000` (minimum `8000`) | Ogranicza długość dowodów przekazywanych do walidatora Groq. |
| `AI_XKIRO_VALIDATOR_TIMEOUT_MS` | `3000` | Maksymalny budżet pojedynczego wywołania walidatora xKiro. |
| `AI_PROVIDER_QUOTA_COOLDOWN_MS` | `60000` ms | Domyślny czas przerwy po wykryciu limitu dla pary dostawca/model; aliasy `xkiro:default` i `openrouter:default` rozwiązują się do skonfigurowanego modelu. Nagłówek `Retry-After` (sekundy lub data HTTP) ma pierwszeństwo. Workflow CI ustawia `1800000` ms na czas live benchmarku. |
| `AI_MAX_FALLBACK_STEPS` | długość łańcucha fallbacków (`6`) | Maksymalna liczba prób fallbacku po odfiltrowaniu niedostępnych endpointów; `0` wyłącza dodatkowe próby. |
| `AI_120B_GLOBAL_MAX_REQUESTS` | `6` | Limit żądań do 120B w procesie w ruchomym oknie 1 godziny. HTTP 402 lub jednoznaczny dzienny limit tokenów (np. TPD) otwiera osobny globalny circuit breaker na 1 godzinę. Zwykły HTTP 429 z krótkim `Retry-After` otwiera tylko cooldown endpointu i nie blokuje 120B na całą godzinę. Workflow CI ustawia `20` dla pięciu próbek. |
| `AI_CACHE_DIR` | katalog projektu (`__dirname`) | Katalog plikowego cache AI. |
| `AI_TAVILY_CACHE_FILE` | `AI_CACHE_DIR/tavily_cache.json` | Ścieżka pliku cache Tavily; ta zmienna ma pierwszeństwo przed `AI_CACHE_DIR`. |
| `TAVILY_MIN_SCORE` | `0.2` | Minimalny score wyniku Tavily; wyniki bez score nie są odrzucane wyłącznie z tego powodu. |
| `AI_BENCHMARK_SEED` | `0` | Ziarno rotacji pytań live benchmarku; 0 oznacza zestaw stały. |
| `AI_BENCHMARK_LIMIT` | `10` (skrypt) | Liczba przypadków live benchmarku; workflow CI jawnie ustawia `5`. |
| `AI_BENCHMARK_DELAY_MS` | `0` ms | Opcjonalna przerwa między przypadkami; workflow CI ustawia `5000` ms. |
| `AI_BENCHMARK_REQUIRE_PERFECT=1` | wyłączona | Kończy run błędem, jeśli nie wszystkie próbki zostały odpowiedziane i kompletne albo choć jeden gold fact nie przejdzie. Workflow CI i przykładowy `.env.example` jawnie włączają tę kontrolę. |
| `PREFLIGHT_TIMEOUT_MS` | `20000` ms | Timeout skryptu `validator-providers-preflight.js`. |
| `PREFLIGHT_STRICT` | `0` | W trybie `1` błędy preflightu walidatorów kończą skrypt kodem niezerowym; nie zmienia zachowania preflightów Groq/Tavily. |

Skrypt live benchmarku domyślnie wybiera `10` przypadków; workflow CI i przykładowy `.env.example` ustawiają `5`. Workflow dodatkowo ustawia `AI_BENCHMARK_DELAY_MS=5000`, `AI_120B_GLOBAL_MAX_REQUESTS=20` oraz `AI_PROVIDER_QUOTA_COOLDOWN_MS=1800000`.

Live benchmark porównuje kompletność planu odpowiedzi oraz ręcznie przygotowane grupy `mustInclude`/`mustNot`. Wynik gold jest dopasowaniem fraz z ograniczoną obsługą odmian, a nie semantycznym weryfikatorem wszystkich twierdzeń; źródła `independentGoldSources` są referencjami do ręcznej kontroli, nie są pobierane ani oceniane automatycznie. Frazy zabronione obniżają teraz także wynik punktowy. Typowe odmowy po polsku i angielsku są klasyfikowane jako abstencja, a nie odpowiedź kompletna.

## Klucze i endpointy dostawców

| Zmienna | Zastosowanie |
|---|---|
| `GROQ_API_KEY` | Groq; w CI preferuj sekret `GROQ_API_KEY_CI`, aby nie zużywać limitu produkcyjnego. |
| `GROQ_BASE_URL` | Opcjonalny endpoint zgodny z OpenAI API; domyślnie endpoint Groq. |
| `GEMINI_API_KEY` | Gemini API. Żądania REST przesyłają klucz w nagłówku `x-goog-api-key`, nie w URL. |
| `OPENROUTER_API_KEY` | OpenRouter. |
| `OPENROUTER_BASE_URL` | Bazowy endpoint OpenRouter zgodny z OpenAI API; domyślnie `https://openrouter.ai/api/v1`. Używany przez generator i walidator. Końcowe ukośniki są usuwane. |
| `XKIRO_API_KEY` | xKiro. |
| `XKIRO_BASE_URL` | Bazowy endpoint xKiro zgodny z OpenAI API; domyślnie `https://api.xkiro.com/v1`. Używany przez generator i walidator. Końcowe ukośniki są usuwane. |
| `TAVILY_API_KEY` | Tavily Search/Extract. |
| `TAVILY_MIN_SCORE` | Próg jakości wyników Tavily. |
| `EXA_API_KEY` | Exa jako dodatkowe źródło wyszukiwania. |

## Pozostałe integracje

Plik `.env.example` w katalogu głównym zawiera listę zmiennych konfiguracyjnych dla integracji YouTube, Twitch, Kick, ITAD, Notion, Trello i pozostałych modułów. Zmienne niezwiązane z AI można pominąć, jeśli odpowiednia funkcja nie jest używana.

## Benchmarki i testy

- `npm test` — testy regresyjne, w tym offline; nie wymaga kluczy do dostawców.
- `npm run benchmark:offline` — deterministyczny benchmark na syntetycznych fixture'ach. Sprawdza kod pipeline'u, nie aktualną jakość modelu ani dostępność API.
- Workflow `AI live benchmark` — uruchamiany ręcznie przez `workflow_dispatch`; wykonuje 5 przypadków na żywych dostawcach. Wymaga poprawnych sekretów i może zużywać limity API.
- Preflight walidatorów mierzy rzeczywistą latencję oraz porównuje ją z limitem produkcyjnym per dostawca. Dłuższy czas diagnostyczny preflightu nie oznacza, że produkcja czeka równie długo.

## Cache werdyktów

Werdykty `accepted` i `rejected` są cache'owane przez 10 minut, maksymalnie 200 wpisów. Cache nie powinien przechowywać werdyktów niejednoznacznych ani niedostępności dostawcy.

## Zgodność API i znane ograniczenia

- **Gemini GenerateContent:** klucz API jest przesyłany nagłówkiem `x-goog-api-key`. System instruction w REST body musi nazywać się `systemInstruction` (camelCase). Wymuszony JSON korzysta z `generationConfig.responseFormat.text` z `mimeType: application/json` i `schema`. Nie używaj przestarzałych pól `responseMimeType` ani `responseSchema` na poziomie `generationConfig`. Zgodnie z aktualną dokumentacją modeli Gemini 3.x kod pomija również przestarzałe parametry próbkowania `temperature`, `top_p` i `top_k`; sterowanie rozumowaniem odbywa się przez wspierane dla danego modelu `thinkingConfig.thinkingLevel`. HTTP 402 (wyczerpane kredyty Prepay) otwiera lokalny 24-godzinny cooldown bez retry; HTTP 429 używa prawidłowego `Retry-After`, jeśli jest dostępny.
- **Groq:** `json_schema` (`strict: true`) jest używany wyłącznie dla modeli obsługujących strict structured outputs (`openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`); pozostałe modele dostają `json_object`. Każdy wynik i tak przechodzi lokalną walidację. Cooldown HTTP 429 respektuje `Retry-After` z nagłówków odpowiedzi SDK, jeśli jest dostępny. Oficjalna lista błędów Groq dokumentuje 429 i 5xx, ale nie wymienia 402; obsługa 402 w kodzie jest defensywnym fallbackiem dla zgodnych endpointów i lokalną polityką 24-godzinnego cooldownu, a nie deklaracją kontraktu Groq.
- **OpenRouter:** używa OpenAI-compatible Chat Completions i `response_format: { type: json_schema, json_schema: { name, strict: true, schema } }`. `provider.require_parameters=true` wymusza routing wyłącznie do endpointu reklamującego obsługę structured outputs; jest to istotne, bo obsługa zależy od endpointu, nie tylko modelu. Sam `json_object` nie gwarantuje zgodności semantycznej i nie jest używany przez produkcyjny validator. HTTP 429 respektuje `Retry-After`. HTTP 402 `openrouter_in_flight_budget` jest przejściowy i respektuje `Retry-After`; `openrouter_credits` z powodem `weight_exceeds_budget` oznacza, że żądanie jest za drogie i wymaga zmniejszenia promptu lub `max_tokens`, więc nie powinno być ponawiane bez zmiany żądania. Dla 402 `openrouter_key_limit` oraz 403 limitów budżetowych kod blokuje całą integrację do przyszłego `resets_at`, jeśli jest dostępne; w przeciwnym razie stosuje lokalną politykę 24 godzin. Błędy 402 oznaczające wyczerpane saldo lub nierozpoznane źródło limitu otrzymują lokalny 24-godzinny cooldown; wyjątkiem jest żądanie `weight_exceeds_budget`, które wymaga zmniejszenia kosztu i nie powinno blokować innych żądań. Te czasy są polityką aplikacji, nie gwarancją resetu dostawcy.
- **xKiro:** używa OpenAI-compatible Chat Completions i `response_format: { type: json_object }`. Zgodnie z dokumentacją błędy należy klasyfikować po statusie oraz stabilnych polach `error.type`/`error.code`, a nie wyłącznie po komunikacie. HTTP 429 respektuje `Retry-After`; HTTP 402 `insufficient_quota` nie jest ponawiany w pętli i otwiera lokalny 24-godzinny cooldown.
- **YouTube Live Chat:** polling korzysta z `pollingIntervalMillis` zwróconego przez API. Nie ustawiaj arbitralnego minimum 10 sekund, bo zwiększa to opóźnienie komend. Dokumentacja YouTube zaleca `liveChatMessages.streamList` dla nowych integracji; migracja z pollingu wymaga osobnego wdrożenia i testu reconnectów. Przy obsłudze błędów tylko `liveChatEnded`, `liveChatNotFound`, `liveChatDisabled` lub komunikat o zakończonym live kończą bieżące nasłuchiwanie; ogólne `forbidden` oznacza problem uprawnień i nie może być automatycznie utożsamiane z końcem transmisji.
- **Twitch Send Chat Message / Stream Marker:** App Access Token uzyskany przez `client_credentials` nie ma własnych scope'ów. Wysłanie wiadomości nim wymaga wcześniejszej autoryzacji aplikacji: konto nadawcy musi przyznać `user:write:chat` i `user:bot`, a broadcaster `channel:bot`, chyba że nadawca jest moderatorem. Kod próbuje tokena użytkownika jako fallbacku po błędzie autoryzacji; taki fallback wymaga scope `user:write:chat` i nie gwarantuje odznaki Chat Bot. Create Stream Marker wymaga natomiast tokena użytkownika będącego broadcasterem ze scope `user:write:broadcast`; funkcja używa `TWITCH_OAUTH_TOKEN_BROADCASTER_BILLY`, nie tokena czatu bota.
- **Kick VOD:** odczyt VOD przez endpoint `kick.com/api/v2/channels/.../livestream` nie jest stabilnym, udokumentowanym publicznym kontraktem API. Zmiana po stronie Kick może go zepsuć; kod powinien traktować brak danych jako błąd integracji, a nie jako dowód, że VOD nie istnieje.
- **HowLongToBeat:** endpoint `/api/bleed` jest wewnętrznym endpointem strony, nie oficjalnym publicznym API. Zależność od niego jest podatna na zmiany po stronie serwisu.
- **TikTok przez RSS-Bridge:** integracja zależy od zewnętrznego mostka i dostępności źródła RSS, a nie od stabilnego oficjalnego API TikToka. Kod sprawdza status HTTP i format Atom; błędy są logowane, ale funkcja nadal zwraca pustą listę do pollera, więc monitoruj logi i nie traktuj braku wpisów jako pewności, że konto nic nie opublikowało.
- **Preflight:** mierzy czas odpowiedzi i kompletność JSON, ale nie potwierdza semantycznej poprawności dowodów. Limity produkcyjne są różne per dostawca i są wyświetlane w podsumowaniu.
