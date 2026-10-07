'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEvidenceText, evaluateEvidence, sanitizeQuestion, decideValidation, finalText, STATUS } = require('../ai/pipeline');

test('pipeline parser reads SOURCE blocks with metadata', () => {
  const parsed = parseEvidenceText([
    '[SOURCE 1]',
    'TYTUŁ: Portal 2 Wiki',
    'URL: https://example.com/portal-2',
    'Wheatley przejmuje kontrolę nad systemem.',
    '',
    '[SOURCE 2]',
    'TYTUŁ: GameFAQs Guide',
    'URL: https://gamefaqs.gamespot.com/portal-2',
    'Opis rozwiązania.',
  ].join('\n'));

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sourceId, 'SOURCE 1');
  assert.equal(parsed[0].title, 'Portal 2 Wiki');
  assert.equal(parsed[0].url, 'https://example.com/portal-2');
  assert.match(parsed[0].content, /Wheatley przejmuje kontrolę/);
  assert.equal(parsed[1].title, 'GameFAQs Guide');
});

test('pipeline parser accepts REFERENCE headers case-insensitively', () => {
  const parsed = parseEvidenceText('[reference Portal 2]\nTYTUŁ: Reference\nURL: https://example.com/reference\nTreść.');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sourceId, 'reference Portal 2');
  assert.equal(parsed[0].title, 'Reference');
  assert.equal(parsed[0].url, 'https://example.com/reference');
});

test('pipeline parser ignores preamble and handles missing metadata', () => {
  const parsed = parseEvidenceText([
    'Preamble.',
    '[SOURCE 1]',
    'Tylko treść bez tytułu i URL.',
    '[SOURCE 2]',
    'TYTUŁ: Drugi',
  ].join('\n'));

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, 'SOURCE 1');
  assert.equal(parsed[0].url, '');
  assert.match(parsed[0].content, /Tylko treść/);
  assert.doesNotMatch(parsed[0].content, /Preamble/);
  assert.equal(parsed[1].title, 'Drugi');
});

test('pipeline parser returns no sources for plain text', () => {
  assert.deepEqual(parseEvidenceText('zwykła odpowiedź bez źródeł'), []);
  assert.deepEqual(parseEvidenceText(''), []);
  assert.deepEqual(parseEvidenceText(null), []);
});

test('pipeline evaluateEvidence scores parsed sources and requires validation for lore', () => {
  const result = evaluateEvidence(
    'Dlaczego Wheatley przejął kontrolę nad GLaDOS w Portal 2?',
    { is_lore: true, game: 'Portal 2', needs_web: true },
    [
      '[SOURCE 1]',
      'TYTUŁ: Portal 2 Wiki',
      'URL: https://minecraft.wiki/portal-2',
      'Wheatley przejmuje kontrolę nad GLaDOS.',
      '[SOURCE 2]',
      'TYTUŁ: GameFAQs',
      'URL: https://gamefaqs.gamespot.com/portal-2',
      'Wheatley kontroluje GLaDOS.',
    ].join('\n'),
  );

  assert.equal(result.evidence.sourceCount, 2);
  assert.ok(result.evidence.independentHosts >= 2);
  assert.ok(['usable', 'strong'].includes(result.evidence.status));
  assert.equal(result.policy.requireValidator, true);
});

test('pipeline input and validation decisions are deterministic', () => {
  assert.equal(sanitizeQuestion('   ', null).ok, false);
  assert.deepEqual(sanitizeQuestion('1234567890', null, 5), { ok: false, reason: 'too_long', maxLength: 5 });
  assert.deepEqual(decideValidation(STATUS.ACCEPTED), { finalStatus: STATUS.ACCEPTED, retry: false });
  assert.equal(decideValidation(STATUS.REJECTED, { allowRetry: true }).retry, true);
  assert.equal(decideValidation('unexpected').finalStatus, STATUS.UNAVAILABLE);
});

test('pipeline finalText replaces terminal failure output and sanitizes accepted output', () => {
  assert.equal(finalText('anything', STATUS.REJECTED), 'Nie mam wystarczających danych, żeby odpowiedzieć na to pewnie.');
  assert.equal(finalText('  poprawna odpowiedź  ', STATUS.ACCEPTED, {
    sanitizeResponse: value => value.replace(/\s+/g, ' '),
  }), 'poprawna odpowiedź');
});
