# YouTube LIVE discovery

The watcher checks the public channel `/live` page every 45 seconds. If it cannot verify a live broadcast, it may use official `search.list(eventType=live)` as a fallback, at most once every three hours per channel.

Quota safeguards:

- YouTube `search.list` has a separate limit of 100 requests per day (not 100 general quota units per request).
- All `search.list` calls in the bot pass through one process-wide rolling 24-hour limiter capped at 80 requests. This leaves 20 requests of headroom for other consumers of the same Search Queries quota.
- The fallback cooldown is three hours even after failures, preventing repeated retries during an outage.
- Candidate IDs from each discovery source are verified in a single `videos.list` request (up to 50 IDs per request), rather than one request per candidate.
- Negative video verifications are cached for five minutes, upcoming broadcasts for 30 seconds, and confirmed LIVE videos for 60 seconds.

Each candidate must belong to the configured channel and have `snippet.liveBroadcastContent === 'live'`. Upcoming broadcasts, VODs, and videos from other channels are rejected.

An active broadcast is not treated as offline merely because Live Chat is disabled. In that case the watcher logs the live video once and retries discovery after the normal interval; it only starts chat polling when `activeLiveChatId` exists. If the primary page and fallback API cannot establish the state (for example, quota exhaustion or fallback cooldown), discovery reports an unknown/error state rather than falsely logging the channel as offline. A successful empty `search.list(eventType=live)` response is still treated as offline.

The 80-request rolling counter is persisted in `.youtube-search-quota.json`, so it survives normal process restarts and deployments that preserve this file. The file is excluded from Git. The counter is designed for one bot process/instance; multiple concurrent instances would require a shared atomic store. The verification cache is in-memory and resets on restart. The normal 3-hour per-channel fallback cooldown also applies independently.

Tests: `node --test test/youtube-live-discovery.test.js`.


Parser strony /live obsługuje przypisania `ytInitialData` i `ytInitialPlayerResponse`
w kilku wariantach składni, dodatkowe etykiety LIVE oraz identyfikatory w
`navigationEndpoint.watchEndpoint`. Kandydat nadal wymaga jawnego sygnału LIVE
i potwierdzenia przez `videos.list`. Przy braku kandydatów log zawiera teraz
diagnostykę parsowania: obecność obiektów inicjalizacyjnych, liczbę rendererów,
liczbę sygnałów LIVE oraz informację o osiągnięciu limitu przeszukiwania.
