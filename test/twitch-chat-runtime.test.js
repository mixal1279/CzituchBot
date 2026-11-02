'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTwitchCommandCooldownKey,
  createTwitchJoinTracker,
  getTwitchCommandName,
  inspectTwitchChatToken,
  normalizeTwitchOAuthToken,
} = require('../twitch/chat-runtime');

test('cooldown key is isolated by channel, login and command', () => {
  assert.equal(
    buildTwitchCommandCooldownKey({ channel: '#BillyBulka', login: 'ViewerA', message: '!AI pytanie 1' }),
    'twitch:billybulka:viewera:!ai'
  );
  assert.notEqual(
    buildTwitchCommandCooldownKey({ channel: 'billybulka', login: 'viewera', message: '!ai pytanie 1' }),
    buildTwitchCommandCooldownKey({ channel: 'billybulka', login: 'viewera', message: '!cm' })
  );
  assert.notEqual(
    buildTwitchCommandCooldownKey({ channel: 'billybulka', login: 'viewera', message: '!ai' }),
    buildTwitchCommandCooldownKey({ channel: 'other', login: 'viewera', message: '!ai' })
  );
  assert.notEqual(
    buildTwitchCommandCooldownKey({ channel: 'billybulka', login: 'viewera', message: '!ai' }),
    buildTwitchCommandCooldownKey({ channel: 'billybulka', login: 'viewerb', message: '!ai' })
  );
});

test('non-command chat messages do not share a command cooldown bucket', () => {
  assert.equal(getTwitchCommandName(' zwykła wiadomość '), '__message__');
  assert.equal(getTwitchCommandName('!HOROSKOP Lew'), '!horoskop');
});

test('OAuth token normalization accepts raw and oauth-prefixed tmi tokens', () => {
  assert.equal(normalizeTwitchOAuthToken('oauth:abc123'), 'abc123');
  assert.equal(normalizeTwitchOAuthToken('abc123'), 'abc123');
  assert.equal(normalizeTwitchOAuthToken(null), '');
});

test('IRC token validation requires the configured bot identity and chat:read', () => {
  const result = inspectTwitchChatToken({
    login: 'czituch_industries',
    user_id: '123',
    client_id: 'client-1',
    scopes: ['chat:read'],
  }, {
    expectedLogin: 'czituch_industries',
    expectedClientId: 'client-1',
    requiredScopes: ['chat:read'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingScopes, []);
});

test('OAuth validation rejects missing chat:read, wrong login and wrong client id', () => {
  const result = inspectTwitchChatToken({
    login: 'someone_else',
    user_id: '123',
    client_id: 'wrong-client',
    scopes: ['chat:edit'],
  }, {
    expectedLogin: 'czituch_industries',
    expectedClientId: 'client-1',
    requiredScopes: ['chat:read'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
});

test('IRC validation rejects app tokens without a user identity', () => {
  const result = inspectTwitchChatToken({
    client_id: 'client-1',
    scopes: [],
  }, { expectedClientId: 'client-1' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /tokenem użytkownika/);
});

test('join tracker becomes ready only after every configured channel is joined', () => {
  const tracker = createTwitchJoinTracker(['billybulka', '#other']);
  assert.equal(tracker.isReady(), false);
  assert.equal(tracker.markJoined('#billybulka'), false);
  assert.deepEqual(tracker.missingChannels(), ['other']);
  assert.equal(tracker.isJoined('billybulka'), true);
  assert.equal(tracker.isJoined('other'), false);
  assert.equal(tracker.markJoined('other'), true);
  assert.equal(tracker.isReady(), true);
  assert.equal(tracker.isJoined('#billybulka'), true);
  assert.equal(tracker.isJoined('other'), true);
  tracker.markPart('billybulka');
  assert.equal(tracker.isReady(), false);
  assert.deepEqual(tracker.missingChannels(), ['billybulka']);
});

test('join tracker clears stale JOIN state after reconnect', () => {
  const tracker = createTwitchJoinTracker(['billybulka']);
  tracker.markJoined('billybulka');
  assert.equal(tracker.isReady(), true);
  tracker.disconnected();
  assert.equal(tracker.isReady(), false);
  assert.deepEqual(tracker.joinedChannels(), []);
});
