'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSupplementalRetrievalQuery, isMultiPartQuestion, selectRetrievalQueries, selectRetrievalDomains, initialRetrievalQueryLimit } = require('../ai/retrieval');


test('preferred lore domains can broaden after weak evidence while persona allowlists remain strict', () => {
  assert.deepEqual(
    selectRetrievalDomains({
      specializedDomains: ['gamelore.fandom.com', 'games.example'],
      generalDomains: ['ign.com', 'fandom.com'],
      useGeneralFallback: false,
    }),
    ['gamelore.fandom.com', 'games.example'],
  );
  assert.deepEqual(
    selectRetrievalDomains({
      specializedDomains: ['gamelore.fandom.com'],
      generalDomains: ['ign.com', 'fandom.com'],
      useGeneralFallback: true,
    }),
    ['ign.com', 'fandom.com'],
  );
  assert.deepEqual(
    selectRetrievalDomains({
      personaDomains: ['trusted-channel.example'],
      specializedDomains: ['gamelore.fandom.com'],
      generalDomains: ['ign.com'],
      useGeneralFallback: true,
    }),
    ['trusted-channel.example'],
  );
  assert.equal(selectRetrievalDomains({
    specializedDomains: ['gamelore.fandom.com'],
    generalDomains: null,
    useGeneralFallback: true,
  }), null);
});

test('single-question retrieval reserves time for validation; multi-part questions can use three searches', () => {
  assert.equal(initialRetrievalQueryLimit({ multiPart: false, availableSlots: 3 }), 2);
  assert.equal(initialRetrievalQueryLimit({ multiPart: true, availableSlots: 3 }), 3);
  assert.equal(initialRetrievalQueryLimit({ multiPart: true, availableSlots: 1 }), 1);
  assert.equal(initialRetrievalQueryLimit({ multiPart: true, availableSlots: 0 }), 0);
});

test('a single question mark does not classify a question as multi-part', () => {
  assert.equal(isMultiPartQuestion('W grze Skyrim: Jak pokonać smoka?'), false);
  assert.equal(isMultiPartQuestion('W grze Portal 2: Dlaczego Wheatley przejął kontrolę nad GLaDOS?'), false);
  assert.equal(isMultiPartQuestion('W grze Baldur\'s Gate 3: Kim jest Astarion?'), false);
});

test('compound questions remain multi-part without relying on punctuation', () => {
  assert.equal(isMultiPartQuestion('Gdzie znaleźć miecz i jak go ulepszyć?'), true);
  assert.equal(isMultiPartQuestion('Kiedy Geralt przybywa do Novigradu i co tam robi?'), true);
});

test('supplemental retrieval anchors the original question to its resolved game', () => {
  const query = buildSupplementalRetrievalQuery('Gdzie znaleźć Wielki Miecz?', { game: 'Elden Ring' });
  assert.match(query, /Elden Ring/i);
  assert.match(query, /Gdzie znaleźć Wielki Miecz/i);
});

test('supplemental retrieval does not accept unverified cross-game locations as input', () => {
  // The builder intentionally has no unsupported-claims argument: rejected claims
  // must not be able to inject hallucinated locations into the next search.
  const query = buildSupplementalRetrievalQuery('Gdzie znaleźć Wielki Miecz?', { game: 'Elden Ring' });
  assert.doesNotMatch(query, /Iron Keep|Deep Church|Sunlit Bell Tower|Dark Souls II/i);
});

test('supplemental retrieval does not duplicate a game already in the question', () => {
  const query = buildSupplementalRetrievalQuery('Gdzie znaleźć Wielki Miecz w Elden Ring?', { game: 'Elden Ring' });
  assert.equal((query.match(/Elden Ring/gi) || []).length, 1);
});

test('causal supplemental retrieval adds causal search terms while preserving the game anchor', () => {
  const query = buildSupplementalRetrievalQuery('Dlaczego Wheatley przejął kontrolę nad GLaDOS?', { game: 'Portal 2' }, true);
  assert.match(query, /Portal 2/i);
  assert.match(query, /cause reason motivation/i);
});

test('retrieval planning preserves causal and specialized queries ahead of extra atomic clauses', () => {
  const queries = selectRetrievalQueries({
    atomicQueries: ['Question part one about Wheatley', 'Question part two about GLaDOS'],
    causalQuery: 'Why did Wheatley gain control of GLaDOS and why did this happen?',
    specializedQueries: ['Portal 2 lore and Wheatley control mechanism'],
    fallbackQueries: ['Generic fallback search query'],
    maxQueries: 2,
  });
  assert.deepEqual(queries, [
    'Why did Wheatley gain control of GLaDOS and why did this happen?',
    'Portal 2 lore and Wheatley control mechanism',
  ]);
});

test('retrieval planning keeps original atomic question and specialized query for non-causal intents', () => {
  const queries = selectRetrievalQueries({
    atomicQueries: ['How to defeat a dragon in Skyrim?', 'Where to find the weapon?'],
    specializedQueries: ['Skyrim combat guide for dragon fights'],
    fallbackQueries: ['Generic fallback search query'],
    maxQueries: 2,
  });
  assert.deepEqual(queries, [
    'How to defeat a dragon in Skyrim?',
    'Skyrim combat guide for dragon fights',
  ]);
});


 
test('game-specific reference domains are added without replacing configured domains', () => {
  const { selectGameSpecificRetrievalDomains } = require('../ai/retrieval');
  assert.deepEqual(
    selectGameSpecificRetrievalDomains('Skyrim', 'Kim jest Dragonborn?', ['ign.com']),
    ['ign.com', 'en.uesp.net', 'elderscrolls.fandom.com'],
  );
  assert.deepEqual(
    selectGameSpecificRetrievalDomains('Minecraft', 'Jak zdobyć elytrę?', ['minecraft.wiki']),
    ['minecraft.wiki'],
  );
  assert.deepEqual(
    selectGameSpecificRetrievalDomains("Baldur's Gate 3", 'Dlaczego Astarion?', null),
    ['bg3.wiki'],
  );
  assert.deepEqual(
    selectGameSpecificRetrievalDomains('GTA V', 'Kiedy Michael poznaje Trevora?', []),
    ['gta.fandom.com'],
  );
});
