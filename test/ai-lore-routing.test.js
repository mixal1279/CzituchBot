'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyAIRequest } = require('../ai/router');
const {
  GAMELORE_DOMAIN,
  czyPytanieOLore,
  czyMaKontekstGry,
  dodajGameLoreDomenę,
} = require('../ai/lore');
const { czyPoprawnyWpisCacheTavily } = require('../ai/tavily');

const benchmark = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'ai-lore-benchmark.json'),
  'utf8',
));
const policy = () => 'web_fact';

test('offline lore benchmark has unique, non-empty cases and declared scope', () => {
  assert.equal(benchmark.scope, 'offline-routing-only');
  assert.ok(benchmark.cases.length >= 12);
  const ids = benchmark.cases.map(item => item.id);
  const questions = benchmark.cases.map(item => item.question.trim().toLocaleLowerCase('pl-PL'));
  assert.equal(new Set(ids).size, ids.length, 'benchmark IDs must be unique');
  assert.equal(new Set(questions).size, questions.length, 'benchmark questions must be unique');
  for (const item of benchmark.cases) {
    assert.ok(item.id && item.skill && item.question);
    assert.equal(typeof item.expected?.isLore, 'boolean');
  }
});

for (const item of benchmark.cases) {
  test('lore benchmark: ' + item.id, () => {
    const routing = classifyAIRequest(item.question, policy, () => false);
    assert.equal(czyPytanieOLore(item.question), item.expected.isLore);
    assert.equal(routing.is_lore, item.expected.isLore);
    if (item.expected.isLore) {
      assert.equal(routing.source_type, item.expected.sourceType);
      assert.equal(routing.needs_web, true);
      assert.deepEqual(dodajGameLoreDomenę([]), [GAMELORE_DOMAIN]);
    } else {
      assert.notEqual(routing.source_type, 'game_lore');
    }
    if (Number.isFinite(item.expected.maxConfidence)) {
      assert.ok(routing.confidence <= item.expected.maxConfidence);
    }
    if (item.expected.requiresClarification) {
      assert.equal(routing.confidence_policy, 'clarify');
    }
  });
}

test('GameLore domain is inserted once and existing source preferences are retained', () => {
  const domains = dodajGameLoreDomenę([
    'ign.com',
    'https://gamelore.fandom.com/wiki/Portal',
    'gamespot.com',
  ]);
  assert.deepEqual(domains, [
    'ign.com',
    'https://gamelore.fandom.com/wiki/Portal',
    'gamespot.com',
  ]);
});

test('generic lore terms without a game context do not trigger GameLore retrieval', () => {
  assert.equal(czyPytanieOLore('Opowiedz mi o historii tej postaci.'), false);
  assert.equal(czyPytanieOLore('Dlaczego to się stało?'), false);
  assert.equal(czyPytanieOLore('Czy warto kupić nową grę?'), false);
});

test('Tavily Firestore cache accepts the canonical object shape and rejects malformed or expired entries', () => {
  const now = Date.now();
  const valid = {
    wynik: {
      status: 'ok',
      text: '[SOURCE 1]\nTREŚĆ: potwierdzony fragment',
      sources: [{ url: 'https://gamelore.fandom.com/wiki/Example' }],
    },
    czas: now - 100,
    ttl: 10_000,
  };
  assert.equal(czyPoprawnyWpisCacheTavily(valid, now), true);
  assert.equal(czyPoprawnyWpisCacheTavily({ ...valid, wynik: valid.wynik.text }, now), false);
  assert.equal(czyPoprawnyWpisCacheTavily({ ...valid, czas: now - 20_000 }, now), false);
  assert.equal(czyPoprawnyWpisCacheTavily({
    ...valid,
    wynik: { ...valid.wynik, sources: [{ title: 'missing URL' }] },
  }, now), false);
});

test('a named but unknown game title is recognized as game context without a title whitelist', () => {
  assert.equal(czyMaKontekstGry('Kim jest Neryth w grze Aetherfall?'), true);
  assert.equal(czyMaKontekstGry('Kim jest Alex?'), false);
});
