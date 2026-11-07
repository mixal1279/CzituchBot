'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'njsscan.yml'), 'utf8');

test('njsscan scans the complete repository with a bounded per-rule timeout', () => {
  assert.match(workflow, /NJSScan\(\['\.'\],\s*True,\s*False\)\.scan\(\)/);
  assert.match(workflow, /--timeout 300/);
  assert.match(workflow, /timeout-minutes:\s*30/);
  assert.doesNotMatch(workflow, /--exclude|--exclude-pattern|njsscan-ignore-all/);
});

test('njsscan workflow fails closed when scanner errors are present', () => {
  assert.match(workflow, /if errors:\s*\n\s+sys\.exit\(1\)/);
  assert.match(workflow, /if \(errors\.length\)\s*\{/);
  assert.match(workflow, /analysis incomplete/);
});

test('njsscan workflow validates and uploads both machine-readable reports', () => {
  assert.match(workflow, /JSON\.parse\(fs\.readFileSync\(file, 'utf8'\)\)/);
  assert.match(workflow, /JSON\.parse\(fs\.readFileSync\(sarifFile, 'utf8'\)\)/);
  assert.match(workflow, /name: njsscan-json-report/);
  assert.match(workflow, /sarif_file: results\.sarif/);
});
