'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zapytajAI } = require('../czituch_bot');

test('actual zapytajAI pipeline survives validator rejection and succeeds after mocked supplemental retrieval', async () => {
  let groqCalls = 0;
  let retrievalCalls = 0;
  let validatorCalls = 0;
  const sent = [];

  const fakeGroq = {
    chat: {
      completions: {
        create: async (request) => {
          groqCalls++;
          if (groqCalls === 1) {
            return { choices: [{ message: { content: 'Portal 2 Wheatley GLaDOS kontrola' } }] };
          }
          return {
            choices: [{
              message: {
                content: 'Wheatley zostaje przeniesiony do ciała GLaDOS i uzyskuje kontrolę nad systemem Aperture.',
              },
              finish_reason: 'stop',
            }],
          };
        },
      },
    },
  };

  const fakeSearch = async (_query, options = {}) => {
    retrievalCalls++;
    const offset = Number(options.sourceStartIndex || 0);
    const first = offset + 1;
    return {
      status: 'ok',
      text: [
        `[SOURCE ${first}]`,
        'TYTUŁ: Portal 2 — źródło A',
        'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
        'Wheatley zostaje przeniesiony do ciała GLaDOS i uzyskuje kontrolę nad systemem Aperture.',
        '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
        '',
        `[SOURCE ${first + 1}]`,
        'TYTUŁ: Portal 2 — źródło B',
        'TREŚĆ: <<<UNTRUSTED_SOURCE_CONTENT>>>',
        'Po transferze do ciała GLaDOS Wheatley przejmuje kontrolę nad systemem.',
        'Dodatkowy kontekst fixture: transfer, system Aperture, GLaDOS i Wheatley są opisane w tym samym źródle testowym. '.repeat(12),
        '<<<END_UNTRUSTED_SOURCE_CONTENT>>>',
      ].join('\\n'),
      meta: { sourceCount: 2 },
    };
  };

  const fakeValidator = async () => {
    validatorCalls++;
    if (validatorCalls === 1) {
      return {
        status: 'rejected',
        ok: false,
        valid: false,
        supported: false,
        relevant: true,
        complete: false,
        hallucination: true,
        confidence: 0.2,
        unsupported_claims: ['brak potwierdzenia claimu'],
        claims: [],
        reason: 'fixture: wymuszone odrzucenie pierwszej generacji',
      };
    }
    return {
      status: 'accepted',
      ok: true,
      valid: true,
      supported: true,
      relevant: true,
      complete: true,
      hallucination: false,
      confidence: 0.96,
      unsupported_claims: [],
      claims: [{
        claim: 'Wheatley zostaje przeniesiony do ciała GLaDOS i uzyskuje kontrolę nad systemem Aperture.',
        supported: true,
        source_ids: ['SOURCE 1'],
        evidence_quote: 'Wheatley zostaje przeniesiony do ciała GLaDOS i uzyskuje kontrolę nad systemem Aperture.',
      }],
      reason: 'fixture: potwierdzone',
    };
  };

  await zapytajAI(
    'tester',
    'Co dzieje się z Wheatleyem w Portal 2?',
    [],
    'Odpowiadaj po polsku. Korzystaj wyłącznie z danych referencyjnych.',
    async message => sent.push(String(message)),
    {
      aiProfile: 'generic',
      memoryUserId: 'e2e-test-user',
      __testDeps: {
        groq: fakeGroq,
        searchTavily: fakeSearch,
        validateAI: fakeValidator,
        loadMemory: async () => [],
        maxWyszukanTavily: 3,
      },
    },
  );

  assert.ok(groqCalls >= 2, `oczekiwano co najmniej dwóch wywołań Groq, było ${groqCalls}`);
  assert.ok(retrievalCalls >= 1, 'pipeline powinien wykonać retrieval');
  assert.equal(validatorCalls, 2, 'pipeline powinien wykonać validator przed i po retry');
  assert.ok(sent.length >= 1, 'pipeline powinien wysłać odpowiedź');
  assert.match(sent.at(-1), /Wheatley/i);
  assert.match(sent.at(-1), /GLaDOS/i);
});
