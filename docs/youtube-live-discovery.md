# YouTube LIVE discovery

The watcher uses two independent discovery sources:

1. The public channel `/live` page is checked on every discovery cycle.
2. If that page does not produce a verified live video, `search.list` with `eventType=live` is used as a quota-expensive fallback. The fallback is throttled per channel to once every three hours after a successful request; failed requests are cooled down for 30 minutes so an API outage or quota error cannot trigger retries every 45 seconds.

Every candidate is verified with `videos.list` and must belong to the configured channel and have `snippet.liveBroadcastContent === 'live'`. Upcoming broadcasts, VODs, and videos from other channels are rejected.

An active broadcast is not treated as offline merely because Live Chat is disabled. In that case the watcher logs the live video once and retries discovery after the normal interval; it only starts chat polling when `activeLiveChatId` exists.

The offline polling interval is 45 seconds. The API fallback interval is deliberately much longer because YouTube `search.list` costs 100 quota units per request. With five configured channels and a three-hour fallback interval, the fallback uses approximately 4,000 quota units per day if every channel reaches the fallback each time.

Tests: `node --test test/youtube-live-discovery.test.js`.
