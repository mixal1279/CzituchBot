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
| `AI_VALIDATOR_GROQ` | zależnie od kodu | Opcja sterująca ścieżką walidatora Groq. |

## Limity i cache

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `AI_ALLOW_PARTIAL_ANSWERS=1` | wyłączona | Pozwala zwrócić wyłącznie claimy z potwierdzonym dowodem po częściowym odrzuceniu odpowiedzi. Nie omija walidacji cytatów, dat/liczb, negacji, ID źródeł ani formatu. Włączaj dopiero po pomiarze fałszywych akceptacji. |
| `AI_GEMINI_EXTRACT=1` | wyłączona | Używa Gemini Grounding do znalezienia stron, a treść pobiera przez Tavily Extract, by walidować cytaty na tekście źródłowym. |
| `AI_QUALITY_ALL_PROFILES=1` | wyłączona | Uruchamia bramkę jakości także dla profili `simple`, `comparison` i `technical`; może zwiększyć liczbę odrzuceń. |
| `AI_GROQ_VALIDATOR_MAX_EVIDENCE_CHARS` | wartość z kodu | Ogranicza długość dowodów przekazywanych do walidatora Groq. |
| `AI_XKIRO_VALIDATOR_TIMEOUT_MS` | `3000` | Maksymalny budżet pojedynczego wywołania walidatora xKiro. |
| `AI_PROVIDER_QUOTA_COOLDOWN_MS` | wartość z kodu | Czas przerwy po wykryciu limitu dostawcy. |
| `AI_MAX_FALLBACK_STEPS` | wartość z kodu | Górna granica kroków fallbacku. |
| `AI_120B_GLOBAL_MAX_REQUESTS` | wartość z kodu | Globalny limit żądań do modelu 120B w procesie. |
| `AI_CACHE_DIR` | wartość z kodu | Katalog plikowego cache AI. |
| `AI_TAVILY_CACHE_FILE` | wartość z kodu | Ścieżka pliku cache Tavily. |
| `TAVILY_MIN_SCORE` | wartość z kodu | Minimalny score wyniku Tavily. |
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
