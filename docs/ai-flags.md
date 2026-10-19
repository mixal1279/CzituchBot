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
| `XKIRO_MODEL` | `qwen/qwen3.5-397b-a17b:free` | Model walidatora xKiro. |
| `AI_VALIDATOR_GROQ` | włączona | Ustaw `0`, aby wyłączyć ścieżkę walidatora Groq. |

## Limity i cache

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `AI_ALLOW_PARTIAL_ANSWERS=1` | wyłączona | Pozwala zwrócić wyłącznie claimy z potwierdzonym dowodem po częściowym odrzuceniu odpowiedzi. Nie omija walidacji cytatów, dat/liczb, negacji, ID źródeł ani formatu. Włączaj dopiero po pomiarze fałszywych akceptacji. |
| `AI_GEMINI_EXTRACT=1` | wyłączona | Używa Gemini Grounding do znalezienia stron, a treść pobiera przez Tavily Extract, by walidować cytaty na tekście źródłowym. |
| `AI_QUALITY_ALL_PROFILES=1` | wyłączona | Uruchamia bramkę jakości także dla profili `simple`, `comparison` i `technical`; może zwiększyć liczbę odrzuceń. |
| `AI_GROQ_VALIDATOR_MAX_EVIDENCE_CHARS` | `12000` (minimum `8000`) | Ogranicza długość dowodów przekazywanych do walidatora Groq. |
| `AI_XKIRO_VALIDATOR_TIMEOUT_MS` | `3000` | Maksymalny budżet pojedynczego wywołania walidatora xKiro. |
| `AI_PROVIDER_QUOTA_COOLDOWN_MS` | `60000` ms | Domyślny czas przerwy po wykryciu limitu dostawcy; `Retry-After` może go nadpisać. |
| `AI_MAX_FALLBACK_STEPS` | długość łańcucha fallbacków | Górna granica kroków fallbacku. |
| `AI_120B_GLOBAL_MAX_REQUESTS` | `6` | Globalny limit żądań do modelu 120B w procesie. |
| `AI_CACHE_DIR` | katalog projektu (`__dirname`) | Katalog plikowego cache AI. |
| `AI_TAVILY_CACHE_FILE` | `AI_CACHE_DIR/tavily_cache.json` | Ścieżka pliku cache Tavily; ta zmienna ma pierwszeństwo przed `AI_CACHE_DIR`. |
| `TAVILY_MIN_SCORE` | `0.2` | Minimalny score wyniku Tavily; wyniki bez score nie są odrzucane wyłącznie z tego powodu. |
| `AI_BENCHMARK_SEED` | `0` | Ziarno rotacji pytań live benchmarku; 0 oznacza zestaw stały. |

## Klucze i endpointy dostawców

| Zmienna | Zastosowanie |
|---|---|
| `GROQ_API_KEY` | Groq; w CI preferuj sekret `GROQ_API_KEY_CI`, aby nie zużywać limitu produkcyjnego. |
| `GROQ_BASE_URL` | Opcjonalny endpoint zgodny z OpenAI API; domyślnie endpoint Groq. |
| `GEMINI_API_KEY` | Gemini API. Żądania REST przesyłają klucz w nagłówku `x-goog-api-key`, nie w URL. |
| `OPENROUTER_API_KEY` | OpenRouter. |
| `OPENROUTER_BASE_URL` | Opcjonalny endpoint OpenRouter zgodny z OpenAI API. |
| `XKIRO_API_KEY` | xKiro. |
| `XKIRO_BASE_URL` | Opcjonalny endpoint xKiro zgodny z OpenAI API. |
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

- **Gemini:** klucz API jest przesyłany nagłówkiem `x-goog-api-key`. Wymuszony JSON korzysta z `generationConfig.responseFormat.text`; nie używaj wycofanego pola `responseSchema`. `thinkingLevel` jest ustawiany tylko dla modeli, dla których kod zna zgodną wartość.
- **YouTube Live Chat:** polling korzysta z `pollingIntervalMillis` zwróconego przez API. Nie ustawiaj arbitralnego minimum 10 sekund, bo zwiększa to opóźnienie komend. Dokumentacja YouTube zaleca `liveChatMessages.streamList` dla nowych integracji; migracja z pollingu wymaga osobnego wdrożenia i testu reconnectów.
- **Twitch Send Chat Message:** App Access Token uzyskany przez `client_credentials` nie ma własnych scope'ów. Wysłanie wiadomości nim wymaga wcześniejszej autoryzacji aplikacji: konto nadawcy musi przyznać `user:write:chat` i `user:bot`, a broadcaster `channel:bot`, chyba że nadawca jest moderatorem. Kod próbuje tokena użytkownika jako fallbacku po błędzie autoryzacji; taki fallback wymaga scope `user:write:chat` i nie gwarantuje odznaki Chat Bot.
- **Kick VOD:** odczyt VOD przez endpoint `kick.com/api/v2/channels/.../livestream` nie jest stabilnym, udokumentowanym publicznym kontraktem API. Zmiana po stronie Kick może go zepsuć; kod powinien traktować brak danych jako błąd integracji, a nie jako dowód, że VOD nie istnieje.
- **HowLongToBeat:** endpoint `/api/bleed` jest wewnętrznym endpointem strony, nie oficjalnym publicznym API. Zależność od niego jest podatna na zmiany po stronie serwisu.
- **TikTok przez RSS-Bridge:** integracja zależy od zewnętrznego mostka i dostępności źródła RSS, a nie od stabilnego oficjalnego API TikToka. Monitoruj błędy pobierania i nie traktuj braku wpisów jako pewności, że konto nic nie opublikowało.
- **Preflight:** mierzy czas odpowiedzi i kompletność JSON, ale nie potwierdza semantycznej poprawności dowodów. Limity produkcyjne są różne per dostawca i są wyświetlane w podsumowaniu.
