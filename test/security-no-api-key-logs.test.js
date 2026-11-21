'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('startup logs never disclose API credential configuration presence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'czituch_bot.js'), 'utf8');
  const sensitiveNames = ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'];
  const logLines = source.split(/\r?\n/u).filter(line => /console\.(?:log|info|debug)\s*\(/u.test(line));
  for (const name of sensitiveNames) {
    assert.equal(
      logLines.some(line => line.includes('process.env.' + name)),
      false,
      'credential presence must not be written to logs: ' + name,
    );
  }
});
