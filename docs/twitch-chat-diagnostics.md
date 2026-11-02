# Twitch chat connection diagnostics

The chat reader uses tmi.js over Twitch IRC. IRC remains supported; the bot must authenticate first and then receive a self `join` event for every configured channel before it reports chat readiness.

## OAuth requirements

The IRC session must use a **user access token** issued to the same Twitch account as `botNick` and the configured Twitch application. The reader requires `chat:read`. `chat:edit` is only required when sending messages through IRC; CzituchBot sends replies through Helix, so it is not required for the IRC reader.

At startup and hourly, the bot calls `GET https://id.twitch.tv/oauth2/validate` with `Authorization: OAuth <access-token>`. It checks the token's login, client ID and scopes without logging the token. If the token has the wrong identity or lacks `chat:read`, re-authorize the bot account with the required scope and update the stored access/refresh token. Refreshing an existing token does not add a missing scope.

## Runtime states

- `connected`: IRC authentication/connection succeeded; this does not prove that a channel JOIN succeeded.
- `join`: tmi.js confirmed the bot's own JOIN/USERSTATE for a configured channel.
- `READY`: every configured channel has confirmed JOIN.
- `part` / `disconnected` / `reconnect`: readiness is cleared until JOIN is confirmed again.
- `notice`: logs the Twitch NOTICE message ID only; chat contents and OAuth credentials are not logged.

Command cooldowns are scoped by channel, account login and command, so one command no longer suppresses a different command from the same viewer.
