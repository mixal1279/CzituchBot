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

test('njsscan fails the job when the scanner process itself fails', () => {
  assert.match(workflow, /NJSSCAN_OUTCOME: \$\{\{\s*steps\.njsscan\.outcome\s*\}\}/);
  assert.match(workflow, /NJSSCAN_OUTCOME !== 'success'/);
  assert.match(workflow, /did not complete successfully/);
});

test('njsscan uses Node 24 compatible maintained actions', () => {
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-python@v7/);
  assert.match(workflow, /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
  assert.match(workflow, /github\/codeql-action\/upload-sarif@v4/);
});

test('njsscan publishes per-rule counts in the Actions summary', () => {
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /counts\.map/);
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
  assert.match(workflow, /steps\.njsscan\.outcome == 'success' && steps\.validate_njsscan\.outcome == 'success'/);
});
