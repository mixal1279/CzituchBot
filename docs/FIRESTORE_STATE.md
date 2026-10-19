# Firestore runtime state migration

CzituchBot stores runtime caches and OAuth tokens in Firestore instead of separate JSON files.

## Required environment variable

Before deploying this branch, add `OAUTH_TOKEN_ENCRYPTION_KEY` to the Pterodactyl server's environment variables. Generate a key once with:

```sh
openssl rand -base64 32
```

Copy the output into the environment variable. Do not commit the key to GitHub, put it in a JSON file, or print it in logs. Keep the same value across restarts. Losing or changing it without re-encrypting the stored documents makes the OAuth tokens unreadable.

OAuth tokens are encrypted with AES-256-GCM before they are written to the `bot_runtime_state` collection. Cache entries are not secret and are stored as regular Firestore documents.

## First startup

The bot migrates existing files when it first loads the corresponding state. It writes the data to Firestore, reads it back to verify the migration, and only then removes the matching legacy file. If Firestore is unavailable or a token write/read-back verification fails, the bot keeps a local token copy with restrictive file permissions (0600) and logs a warning. Do not manually delete a retained file until the bot confirms that its data is stored correctly. If a local token/cache backup is newer than the last successful Firestore write, startup attempts to restore it and only removes the file after read-back verification. A stale local token file does not override a newer readable Firestore token.

When Firestore cache writes fail, local JSON files may reappear as recovery copies. These are intentional fallbacks; they should only be removed after Firestore has accepted and verified the latest state.

The migrated OAuth providers are YouTube, Kick, the Billy broadcaster token, and Twitch chat tokens. The migrated runtime data includes daily command assignments, the `!cm` stream cache, Tavily search cache, Billy bakery assignments, and TikTok tracking state.

## Firestore documents

Runtime state is stored in the `bot_runtime_state` collection. Document IDs use a `cache__` or `oauth__` prefix. Do not edit token documents manually.

## Deployment checklist

1. Set `OAUTH_TOKEN_ENCRYPTION_KEY` in Pterodactyl before restarting the bot.
2. Deploy the branch/PR and start the bot.
3. Check startup logs for migration/verification messages and warnings.
4. Confirm commands and OAuth refreshes still work.
5. Only remove any legacy JSON files that remain after checking the relevant warning.
