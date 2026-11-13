'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ai-tests.yml'), 'utf8');

test('AI regression workflow runs for main and hardening branch pushes plus PR updates', () => {
  const pushBranches = workflow.match(/push:\s*\n\s+branches:\s*\[([^\]]+)\]/);
  assert.ok(pushBranches, 'workflow must define push branches');
  assert.match(pushBranches[1], /\bmain\b/, 'push trigger must include main');
  assert.match(pushBranches[1], /\baudit\/full-bot-hardening\b/, 'push trigger must include the hardening branch');
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\[\s*main\s*\]/);
});

test('AI regression workflow cancels superseded runs for the same PR', () => {
  assert.match(workflow, /group:\s*ai-tests-\$\{\{\s*github\.event\.pull_request\.number\s*\|\|\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
});
