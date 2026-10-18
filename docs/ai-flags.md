# Flagi i ustawienia systemu AI

Wszystkie poniższe ustawienia są opcjonalne. Bez nich zachowanie jest takie jak dotychczas
(poza poprawkami błędów).

| Zmienna | Domyślnie | Co robi |
|---|---|---|
| `AI_ALLOW_PARTIAL_ANSWERS=1` | wyłączona | Gdy walidator odrzuca odpowiedź, ale część claimów ma zweryfikowany cytat, bot odpowiada samymi potwierdzonymi claimami (status `soft_accepted`). Pozostałe twierdzenia są pomijane. Wszystkie progi (confidence, liczby/daty, negacje, nieznane źródła, format) zostają. Włączaj po zmierzeniu fałszywych akceptacji na benchmarku. |
| `AI_GEMINI_EXTRACT=1` | wyłączona | Gemini grounding służy tylko do znalezienia stron, a ich treść pobiera Tavily Extract. Walidator porównuje wtedy cytat z prawdziwym tekstem strony. Kształt odpowiedzi API czytany defensywnie (nieweryfikowany na żywym API). |
| `AI_QUALITY_ALL_PROFILES=1` | wyłączona | Bramka jakości (`ai/quality.js`) obejmuje też profile `simple`, `comparison`, `technical`. Zwiększa liczbę odrzuceń. |
| `AI_GEMINI_VALIDATOR_MODEL` | `gemini-3.5-flash-lite` | Model Gemini używany jako walidator. Pozwala porównać modele na benchmarku bez zmiany kodu. |
| `AI_BENCHMARK_SEED` | `0` | Rotacja pytań live benchmarku (0 = stały zestaw). Także jako input workflow. |
| `GROQ_API_KEY_CI` (secret) | brak | Osobny klucz Groq dla CI, żeby benchmark nie zużywał dziennego limitu produkcyjnego bota. |

## Benchmarki

- `npm run benchmark:offline` — deterministyczna część pipeline'u na nagranych przypadkach
  (`test/fixtures/ai-offline-cases.json`), bez sieci i limitów. Dowody i odpowiedzi są
  syntetyczne, więc to test kodu, nie modelu. Wchodzi też do `npm test`.
- Live benchmark (workflow `ai-live-benchmark`) mierzy model i dostawców. Przed runem działa
  preflight Groq/Tavily, a run bez żadnej odpowiedzi Groqa jest oznaczany jako nieważny.

## Cache werdyktów walidatora

Ta sama odpowiedź sprawdzana przeciw tym samym źródłom (TTL 10 min, do 200 wpisów) nie wywołuje
modelu drugi raz. Cache'owane są tylko jednoznaczne werdykty (`accepted`, `rejected`).
