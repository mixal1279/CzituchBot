'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');

test('IGDB reuses the shared Twitch App Access Token cache', () => {
  const start = source.indexOf('async function pobierzTokenIGDB()');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  const loader = source.slice(start, end + 2);
  assert.match(loader, /return pobierzTwitchAppToken\(\)/);
  assert.doesNotMatch(loader, /client_secret|oauth2\/token\?/);
});

test('Twitch App Access Token uses form body, not URL query parameters', () => {
  const start = source.indexOf('async function pobierzTwitchAppToken()');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  const loader = source.slice(start, end + 2);
  assert.match(loader, /fetchZTimeout\('https:\/\/id\.twitch\.tv\/oauth2\/token'/);
  assert.match(loader, /body:\s*new URLSearchParams/);
  assert.doesNotMatch(loader, /oauth2\/token\?client_secret/);
});
