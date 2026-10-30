'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');

test('YouTube OAuth binds callback to state and uses PKCE S256', () => {
  const start = source.indexOf('async function zalogujYouTube()');
  const end = source.indexOf('\nasync function ', start + 10);
  assert.ok(start >= 0 && end > start, 'YouTube OAuth function should exist');
  const oauth = source.slice(start, end);

  assert.match(oauth, /crypto\.randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(oauth, /generateCodeVerifierAsync\(\)/);
  assert.match(oauth, /state:\s*oauthState/);
  assert.match(oauth, /code_challenge:\s*codeChallenge/);
  assert.match(oauth, /code_challenge_method:\s*'S256'/);
  assert.match(oauth, /callbackState !== oauthState/);
  assert.match(oauth, /url\.searchParams\.get\('error'\)/);
  assert.match(oauth, /Google OAuth zwrócił błąd; szczegóły odpowiedzi pominięto/);
  assert.doesNotMatch(oauth, /'Google OAuth zwrócił błąd: '\s*\+\s*oauthError/);
  assert.match(oauth, /getToken\(\{\s*code,\s*codeVerifier\s*\}\)/);
});

test('unreadable Firestore token store cannot trigger a new OAuth flow', () => {
  const start = source.indexOf('async function wczytajTokenYT()');
  const end = source.indexOf('\nasync function zalogujYouTube()', start);
  assert.ok(start >= 0 && end > start, 'YouTube token loader should exist');
  const loader = source.slice(start, end);
  assert.match(loader, /let firestoreReadFailed = false/);
  assert.match(loader, /if \(firestoreReadFailed && !credentials\)/);
  assert.match(loader, /throw new Error\('\[YT Auth\]/);
});

test('YouTube auth failures do not prevent other platform startup', () => {
  const start = source.lastIndexOf('const startBot = async');
  const end = source.indexOf('\nif (require.main === module)', start);
  assert.ok(start >= 0 && end > start, 'startBot should exist');
  const startup = source.slice(start, end);

  assert.match(startup, /let youtubeReady = false/);
  assert.match(startup, /catch \(youtubeError\)/);
  assert.match(startup, /uruchomTwitch\(TWITCH_CONFIG_BILLYBULKA\)/);
  assert.match(startup, /uruchomEventSubBilly\(\)/);
  assert.match(startup, /if \(youtubeReady\) \{[\s\S]*youtubeWatcher\(/);
});
