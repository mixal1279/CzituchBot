# AI pipeline architecture

This document defines the stage boundaries for the CzituchBot factual-answer pipeline. The boundaries are intentional: a retrieval failure, a generation failure, and an evidence-validation failure must not collapse into one generic "hallucination" result.

## Stage contracts

1. **Request planning** — normalize and route the question; derive an answer plan and the retrieval queries required by its intent. Planning may declare required answer slots, but it is not evidence that those slots have been answered.
2. **Retrieval** — collect source blocks with stable source IDs and metadata. Query planning and source ranking are retrieval concerns. Source count, query success, or a relevant page title alone does not prove a claim. Tavily Search excerpts and Exa highlights are retained only as snippet metadata; only Tavily `raw_content`, Exa extracted `text`, or text returned by Tavily Extract may become factual evidence. A basic snippet-only result returns empty evidence without spending a secondary-provider call; the request planner can use its next advanced query. An advanced snippet-only result may try secondary full-text extraction. In either case, snippets never become source-content blocks. The Tavily cache schema version is bumped when evidence semantics change so old snippet-bearing entries cannot bypass this rule.
3. **Evidence policy** — assess source quality/relevance and decide whether external evidence and a validator are required. Parse the same source-content boundaries for evidence scoring and claim validation; titles and URLs must not silently become evidence text.
4. **Generation** — draft only the user-facing answer. Internal evidence-candidate labels are removed before deterministic guards, validation, repair, or delivery. Logs record the contract violation, never a fragment of generated answer text.
5. **Claim validation** — split the answer into atomic claims; require known source IDs and a contiguous quote from the cited source; bind short infobox fields to the nearby claimed entity; check names, numbers, units, temporal signals, negation, event/action conflicts, and causal relations. A purpose clause or stated capability is not proof that its intended outcome occurred.
6. **Claim-to-answer coverage** — independently check that the set of validated claims covers every material answer sentence. Claims may jointly cover a sentence only when each contributing claim has a meaningful lexical and semantic connection to that sentence; aggregate name overlap is not enough.
7. **Answer completeness and deterministic guards** — evaluate the answer against the planned slots and apply hard factual/format guards. This stage answers "did we answer the question?" and does not replace the claim-support check.
8. **Bounded repair** — repair only when the shared request deadline leaves enough time for generation and revalidation. Provider fallbacks stay inside the shared budget. A repaired answer goes through claim validation and deterministic guards again; repair never grants an exemption from the original checks.
9. **Finalization** — deliver an answer only when the applicable gates pass. On rejection, inconclusive validation, or provider unavailability, abstain. A generated candidate marked `UNVERIFIED` is never sent to the user when the semantic validator is unavailable; deterministic format/completeness guards do not replace claim validation.

## Evaluation and diagnostics

Keep these dimensions separate in tests and benchmark reports:

- **Retrieval/transport:** search calls, source availability, source count, HTTP failures, timeouts, and provider quota.
- **Answer completeness:** planned slots and multi-clause coverage.
- **Claim support:** exact quote verification, source-ID validity, per-claim verdict, and overclaim categories.
- **Semantic consistency:** names/entities, numbers and units, polarity/negation, event type, language alignment, and cause-versus-purpose.
- **Pipeline outcome:** accepted, evidence rejection, semantic rejection, abstention, provider quota, provider timeout, budget exhaustion, and unexpected pipeline error.

Offline regression tests are the fast gate for deterministic behavior. The live benchmark is a separate, manually triggered integration check because it consumes provider/search quota and can fail for reasons unrelated to factual correctness. A passing offline suite is necessary but does not, by itself, establish live provider health or zero hallucination risk.


## Conversation scope, concurrency, and diagnostics

Conversation history and verified user memory use a stable scope key:

`platform:channel:user-id`

- Twitch uses the IRC `user-id` tag, falling back to the normalized login when the tag is absent.
- YouTube uses `authorDetails.channelId`. If the API omits it, the request receives a random one-message history key and verified personal memory is disabled; the display name is not used as a persistent identity.
- Kick uses the sender ID. If the event omits it, the request receives a random one-message history key and verified personal memory is disabled; the sender name is used only for the non-sensitive cooldown scope.
- Twitch retains the normalized login fallback because the IRC login is an account handle; the stable `user-id` tag is preferred.
- Platform and channel components are normalized to lowercase. Platform user IDs retain their original case because provider IDs may be case-sensitive.
- The in-memory conversation history is bounded to 500 scopes and evicted by least-recent use. The LRU timestamp must use the same complete scope key as the history map.

The AI request queue is process-wide because it protects shared provider capacity: at most 3 active jobs and 20 queued jobs. A completed job transfers its slot directly to the next waiter; the active counter is not decremented during handoff. A full queue rejects the new request with `AI_QUEUE_FULL`, and a queued request or provider-state initialization expires after 15 seconds with `AI_QUEUE_TIMEOUT` so stale work cannot hold memory indefinitely.

Provider diagnostics use an allowlist of safe error fields. Request headers, request bodies, credentials, raw generated payloads, and provider response bodies are not serialized into logs. Error messages are redacted before logging.

## Platform coverage

The current repository has AI chat entry points for Twitch, YouTube, and Kick. Discord references in this codebase are outbound alert/social integrations; the package does not include a Discord gateway client or an AI message-ingress handler. Discord AI chat must therefore be treated as an unimplemented platform, not as a tested ingress path.

Public retrieval caches and provider quota/cooldown state are process-wide by design. They contain shared provider/public-data state, not per-user conversation history. Conversation history and verified memory must never use a nick-only key when a stable platform identity is available.

## Change rule

When changing a guard, add both a positive and a negative regression case. Prefer a narrow rule tied to the specific failure mode over globally lowering thresholds. If a heuristic cannot reliably distinguish a fact from a purpose clause, rhetorical negation, or a shared proper noun, it must not silently turn that ambiguity into a supported factual claim.

## Dynamiczne rozpoznawanie gry i awaria klasyfikatora

Dla pytań lore z jawnym kontekstem „w grze X” pipeline najpierw wyodrębnia tytuł bez użycia LLM. Tytuł jest następnie wyszukiwany w IGDB i przechodzi lokalne dopasowanie do oryginalnego pytania. Dotyczy to również nieznanych, jednowyrazowych nazw i nie wymaga rozszerzania statycznej whitelisty. Zapytanie pobiera także `game_type`, `franchise(s)`, `collections`, `parent_game`, `version_parent`, relacje remake/remaster/DLC/expansion oraz `first_release_date`. `ai/game-relations.js` wybiera zakres gry, franczyzy lub kolekcji tylko wtedy, gdy relacja IGDB potwierdza dopasowanie. Dla franczyzy retrieval nie wybiera automatycznie pierwszej części i dopuszcza źródła o różnych grach z tej samej serii. Dla zwykłego zapytania o grę odrzuca kandydata będącego DLC, dodatkiem, bundle, remakiem, remasterem, portem, epizodem lub alternatywną wersją, jeśli użytkownik nie wskazał takiego wariantu. Żądanie remake/reboot/remaster/spin-off/DLC/wydania jest akceptowane tylko przy zgodnym `game_type` lub relacji; brak jednoznacznej klasyfikacji oznacza brak potwierdzenia, a nie zgadywanie. Metadane IGDB (w tym data pierwszego wydania) służą wyłącznie do identyfikacji zakresu i nie są dowodem faktów fabularnych. Numery rzymskie są normalizowane. Wyniki IGDB są przechowywane w ograniczonym cache (100 wpisów, 30 min dla trafień, 5 min dla braku wyniku) z deduplikacją równoległych zapytań. Cache zawiera wyłącznie publiczne metadane gier, nie dane kanałów ani użytkowników. Groq pozostaje fallbackiem dla pytań bez jednoznacznego prefiksu. Brak dopasowania IGDB nie jest traktowany jako dowód — retrieval zachowuje zwykły fallback GameLore.

## Bezpieczeństwo URL w ekstrakcji stron

Przed przekazaniem adresów źródeł do Tavily Extract pipeline odrzuca adresy inne niż HTTP(S), hosty lokalne i zarezerwowane, literały IP, URL-e z userinfo, niestandardowe porty, parametry z typowymi sekretami oraz wejścia dłuższe niż 2048 znaków. Następnie sprawdza wszystkie odpowiedzi DNS A/AAAA; jeśli choć jeden adres jest prywatny, lokalny lub zarezerwowany albo DNS nie odpowie w 1,5 s, URL jest odrzucany. Jedno żądanie obejmuje maksymalnie 3 URL-e. Odpowiedzi providerów są ograniczone do 512 KiB, a tekst pojedynczej strony do 12 000 znaków. Żądania do stałych endpointów providerów używają `redirect: error`. To ogranicza SSRF, ale nie eliminuje DNS rebindingu między naszym sprawdzeniem a ponownym rozwiązaniem DNS przez zewnętrzny serwis Tavily ani nie pozwala nam kontrolować jego przekierowań. Ten residual risk pozostaje jawnie otwarty.
## Intencja obliczeniowa

Jawne polecenia arytmetyczne („oblicz”, „policz”, „ile to”) zawierające wyrażenie liczbowe otrzymują intencję calculation i nie uruchamiają wyszukiwania webowego. Wynik pochodzi z lokalnego deterministycznego evaluatora bez `eval()` i `Function()`. Obsługuje `+`, `-`, `*`, `/`, nawiasy, jednoargumentowe znaki oraz przecinek lub kropkę dziesiętną. Ograniczenia: 120 znaków wyrażenia, 64 tokeny, 12 poziomów nawiasów i wartości bezwzględne do `1e12`; dzielenie przez zero i nieznane znaki są odrzucane. LLM nie wyznacza wyniku.


## Kontrola kompletności njsscan

Workflow generuje raport JSON i SARIF. Raport JSON jest walidowany przed zakończeniem joba: brak pliku, nieprawidłowy JSON, nieoczekiwany schemat lub błędy skanera (w tym timeouty analizy) powodują niezaliczenie kontroli. Sam fakt, że krok skanera zakończył się bez błędu procesu, nie oznacza kompletnego skanowania.


## Epistemic status of lore claims

Lore claim support has additional hard-overclaim checks. If the cited span explicitly frames a proposition as a fan theory, hypothesis, rumour, or unconfirmed claim, the answer must preserve that label; otherwise the claim is rejected as speculation presented as fact. Interpretive readings must likewise remain labelled as interpretations. A claim that asserts canonical or official status must contain explicit status language in its own cited span; ordinary plot evidence is not sufficient to establish canonicity. These checks validate the wording present in the cited evidence, not the real-world authority of the publisher or developer. Source authenticity and official provenance still require separate source-level verification.


## Regex input limits and static-analysis scope

Regex-heavy AI helpers reject or bound untrusted input before matching: user questions are limited to 4,000 characters in routing/planning, normalized source/evidence text to 12,000 characters, claim/evidence comparison inputs to 1,000/2,000 characters, and dynamic citation tokens to 120 characters. Oversized claim-support input is a hard validation failure, not a truncated accepted claim. YouTube Channel IDs are validated as exactly 24 characters (UC plus 22 allowed characters) before any network request. Equality checks reported by njsscan as timing attacks compare public lexical tokens or entity aliases; they do not compare credentials, MACs, password hashes, or secret tokens and are annotated at the comparison site.

The njsscan workflow uses Semgrep's explicit 120-second per-rule timeout for large source files. The JSON report remains authoritative for scan completeness: any scanner error/timeout fails validation, and JSON/SARIF artifacts are retained for review. A timeout is not treated as a false positive.


The public YouTube channel /live page is capped at 512 KiB. When the response exposes a readable stream, the reader cancels it as soon as the byte limit is exceeded; text-only test adapters are checked after reading. Oversized HTML is not parsed for video IDs, and the existing authenticated/public video verification path remains authoritative.
