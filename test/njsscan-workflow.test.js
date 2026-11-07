'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'njsscan.yml'), 'utf8');


test('njsscan runs once per PR update instead of duplicating push and pull_request scans', () => {
  assert.match(workflow, /push:\s*\n\s+branches:\s*\[\s*main\s*\]/);
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\[\s*main\s*\]/);
  assert.doesNotMatch(workflow, /push:\s*\n\s+branches:\s*\[[^\]]*audit\/full-bot-hardening/);
});


test('njsscan cancels superseded scans for the same pull request', () => {
  assert.match(workflow, /group:\s*njsscan-\$\{\{\s*github\.event\.pull_request\.number\s*\|\|\s*github\.ref\s*\}\}/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
});

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
  assert.match(workflow, /if: steps\.njsscan\.outcome == 'success' && steps\.validate_njsscan\.outcome == 'success'/);
});


test('incomplete njsscan output is never uploaded to Code Scanning as SARIF', () => {
  assert.match(workflow, /id: validate_njsscan/);
  assert.match(workflow, /steps\\.njsscan\\.outcome == 'success' && steps\\.validate_njsscan\\.outcome == 'success'/);
});
