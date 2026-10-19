# CzituchBot

Bot integrujący funkcje czatu i automatyzacje dla YouTube Live, Twitcha oraz Kicka. Repozytorium zawiera również system AI do wyszukiwania źródeł, generowania odpowiedzi i walidacji twierdzeń.

## Wymagania

- Node.js 20 lub nowszy (CI testuje na Node.js 24).
- Klucze API i tokeny tylko dla integracji, z których korzystasz.
- Konfiguracja Firestore / Google Cloud, jeśli uruchamiasz funkcje korzystające z bazy.
- Tokeny OAuth platform zapisane zgodnie z konfiguracją danego modułu.

## Instalacja

1. Sklonuj repozytorium i przejdź do katalogu projektu.
2. Skopiuj `.env.example` do `.env`.
3. Uzupełnij sekrety wymagane przez używane integracje. Nie commituj pliku `.env`, tokenów ani plików z poświadczeniami.
4. Zainstaluj zależności: `npm install`.
5. Uruchom testy: `npm test`.
6. Uruchom bota: `npm start`.

Nie wszystkie integracje są wymagane jednocześnie. Jeśli moduł potrzebuje sekretu, a nie jest on skonfigurowany, dana funkcja może być niedostępna. Zanim uruchomisz bota na produkcji, sprawdź logi startowe oraz autoryzację usług, których używasz.

## System AI

Szczegóły modeli, limitów, cache i przełączników są opisane w [docs/ai-flags.md](docs/ai-flags.md).

- `npm test` — testy regresyjne, w tym testy offline.
- `npm run benchmark:offline` — deterministyczny test pipeline'u na syntetycznych danych.
- Workflow **AI live benchmark** — ręczny test pięciu przypadków na żywych dostawcach; wymaga skonfigurowanych GitHub Actions Secrets i może zużywać limity API.

Testy offline nie potwierdzają dostępności dostawców ani bieżącej jakości modeli. Po zmianach integracji należy sprawdzić logi preflightu i, gdy klucze są dostępne, uruchomić live benchmark ręcznie.

## Bezpieczeństwo

- Przechowuj klucze w `.env` lokalnie oraz w GitHub Actions Secrets w CI.
- Nie umieszczaj kluczy API w URL ani w logach.
- Nie wklejaj zawartości `.env` do zgłoszeń, logów ani rozmów.
- Używaj osobnego klucza Groq dla CI (`GROQ_API_KEY_CI`), aby benchmark nie zużywał limitu produkcyjnego.
