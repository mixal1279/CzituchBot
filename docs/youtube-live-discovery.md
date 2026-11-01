# YouTube LIVE discovery

The watcher checks the public channel `/live` page every 45 seconds. If it cannot verify a live broadcast, it may use official `search.list(eventType=live)` as a fallback, at most once every three hours per channel.

Quota safeguards:

- YouTube `search.list` has a separate limit of 100 requests per day (not 100 general quota units per request).
- All `search.list` calls in the bot pass through one process-wide rolling 24-hour limiter capped at 80 requests. This leaves 20 requests of headroom for other consumers of the same Search Queries quota.
- The fallback cooldown is three hours even after failures, preventing repeated retries during an outage.
- Candidate IDs from each discovery source are verified in a single `videos.list` request (up to 50 IDs per request), rather than one request per candidate.
- Negative video verifications are cached for five minutes. Upcoming broadcasts use a 30-second cache so a transition to LIVE is detected promptly.

Each candidate must belong to the configured channel and have `snippet.liveBroadcastContent === 'live'`. Upcoming broadcasts, VODs, and videos from other channels are rejected.

An active broadcast is not treated as offline merely because Live Chat is disabled. In that case the watcher logs the live video once and retries discovery after the normal interval; it only starts chat polling when `activeLiveChatId` exists.

The 80-request limiter and verification cache are in-memory and reset when the Node.js process restarts. The normal 3-hour per-channel cooldown also applies independently. For a strict quota guarantee across process restarts or multiple bot instances, the rolling counters would need durable shared storage.

Tests: `node --test test/youtube-live-discovery.test.js`.
