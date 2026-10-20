'use strict';

function normalizeEvidenceText(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeLeadingSourceMetadataNoise(value) {
  const lines = String(value || '').replace(/\r/g, '').split('\n');
  // Search extraction can prepend document metadata to the body. These lines
  // are not evidence: matching a character name in a page title must never
  // create a candidate quote or satisfy claim validation.
  while (lines.length) {
    const line = lines[0].trim();
    if (!line) {
      lines.shift();
      continue;
    }
    if (/^(?:page\s+title|document\s+title|source\s+title|title|tytuł|tytul|nagłówek|naglowek|źródło|zrodlo|adres|url|host|hostname|filename|file\s+name|nazwa\s+pliku)\s*:\s*\S.*$/i.test(line)) {
      lines.shift();
      continue;
    }
    break;
  }
  // Unmarked source blocks may retain the extraction label on the body line.
  // Remove the label itself, not the text that follows it.
  return lines.join('\n').trim().replace(/^TREŚĆ:\s*/i, '').trim();
}

function isEscapedAt(text, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function escapeUntrustedEvidenceContent(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/<<<(END_)?UNTRUSTED_SOURCE_CONTENT>>>/gi, '\\$&');
}

function unescapeUntrustedEvidenceContent(value) {
  return String(value || '')
    .replace(/\\(<<<(?:END_)?UNTRUSTED_SOURCE_CONTENT>>>)/gi, '$1')
    .replace(/\\\\/g, '\\');
}

function findUnescapedMarker(text, marker, startIndex = 0) {
  const upperText = String(text || '').toUpperCase();
  const upperMarker = String(marker || '').toUpperCase();
  let index = upperText.indexOf(upperMarker, startIndex);
  while (index >= 0 && isEscapedAt(text, index)) {
    index = upperText.indexOf(upperMarker, index + upperMarker.length);
  }
  return index;
}

function extractMarkedEvidenceContent(block) {
  const opening = /TREŚĆ:\s*<<<UNTRUSTED_SOURCE_CONTENT>>>/i.exec(block);
  if (!opening) return null;

  let contentStart = opening.index + opening[0].length;
  // Match the former parser's whitespace handling after the opening marker.
  while (contentStart < block.length && /\s/.test(block[contentStart])) contentStart++;

  const closingMarker = '<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
  const closingIndex = findUnescapedMarker(block, closingMarker, contentStart);
  if (closingIndex < 0) return null;
  return block.slice(contentStart, closingIndex);
}

function findEvidenceHeaderMatches(text) {
  const matches = [];
  let offset = 0;
  let insideUntrustedContent = false;
  // Delimiters embedded in source text must be escaped by the formatter.
  // Only unescaped markers can change parser state.
  for (const lineWithEnding of text.match(/[^\n]*(?:\n|$)/g) || []) {
    if (!lineWithEnding) continue;
    const line = lineWithEnding.replace(/[\r\n]+$/g, '');
    if (!insideUntrustedContent) {
      const match = line.match(/^\[(SOURCE \d+|REFERENCE [^\]\r\n]+)\]\s*$/i);
      if (match) matches.push({ index: offset, 0: line, 1: match[1] });
    }
    const upper = line.toUpperCase();
    const openMarker = '<<<UNTRUSTED_SOURCE_CONTENT>>>';
    const closeMarker = '<<<END_UNTRUSTED_SOURCE_CONTENT>>>';
    for (let i = 0; i < line.length;) {
      const openAt = upper.indexOf(openMarker, i);
      const closeAt = upper.indexOf(closeMarker, i);
      if (openAt < 0 && closeAt < 0) break;
      const isOpen = closeAt < 0 || (openAt >= 0 && openAt < closeAt);
      const at = isOpen ? openAt : closeAt;
      const marker = isOpen ? openMarker : closeMarker;
      if (!isEscapedAt(line, at)) insideUntrustedContent = isOpen;
      i = at + marker.length;
    }
    offset += lineWithEnding.length;
  }
  return matches;
}

function parseEvidenceBlocks(data) {
  const text = String(data || '');
  const matches = findEvidenceHeaderMatches(text);
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const block = text.slice(start, end);
    const markedContent = extractMarkedEvidenceContent(block);
    const rawContent = markedContent ?? block;
    const content = removeLeadingSourceMetadataNoise(unescapeUntrustedEvidenceContent(rawContent));
    // PROVIDER czytamy tylko z nagłówka (przed treścią), żeby strona nie mogła go podrobić.
    const header = block.split(/TREŚĆ:/i)[0];
    const provider = header.match(/^\s*PROVIDER:\s*([^\r\n]+)/im)?.[1]?.trim();
    const title = header.match(/^\s*TYTUŁ:\s*([^\r\n]+)/im)?.[1] || '';
    const url = header.match(/^\s*URL:\s*(https?:\/\/[^\s\r\n]+)/im)?.[1] || '';
    return { sourceId: match[1].trim(), title, url, content, ...(provider ? { provider } : {}) };
  });
}

function normalizeQuoteVerificationText(value) {
  // Preserve sentence boundaries even when punctuation is missing following
  // whitespace ("Alpha.Beta"). Keep decimal points between digits as ordinary
  // punctuation so values such as 3.14 are not split into separate sentences.
  const withSentenceBoundaries = String(value || '')
    .replace(/([.!?])/gu, (match, punctuation, offset, text) => {
      const previous = text[offset - 1] || '';
      const next = text.slice(offset + 1).match(/^\s*(\S)/u)?.[1] || '';
      if (!next) return punctuation;
      if (punctuation === '.' && /\d/u.test(previous) && /\d/u.test(next)) {
        return punctuation;
      }
      return ' SENTENCEBOUNDARYTOKEN ';
    });
  return normalizeEvidenceText(withSentenceBoundaries);
}

function quoteExists(sourceContent, quote) {
  const sourceSegments = String(sourceContent || '')
    // Split before punctuation normalization: otherwise source-side ellipses
    // collapse into spaces and allow a quote to bridge omitted text.
    .split(/\[\s*(?:\.{3}|…)\s*\]|\.\.\.|…/u)
    .map(normalizeQuoteVerificationText)
    .filter(Boolean);
  const q = normalizeQuoteVerificationText(quote);
  // A quote must be one contiguous span after conservative text normalization.
  // Disconnected fragments joined by an ellipsis can hide omitted negations,
  // entities, or causal language and must not count as a verbatim quotation.
  if (/\[\s*(?:\.{3}|…)\s*\]|\.\.\.|…/u.test(String(quote || ''))) return false;
  return Boolean(q && q.length >= 3 && sourceSegments.some(source => source.includes(q)));
}

function splitEvidenceSentences(text) {
  const raw = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+(?=#{1,6}\s)/gu, '\n')
    .replace(/\s+(?=\d+(?:\.\d+)*\s+[A-ZÀ-ÖØ-Þ])/gu, '\n')
    .replace(/\s+(?=(?:main article:|contents\b|gallery\b|development\b|post-release\b))/giu, '\n')
    .replace(/\[\s*(?:\.{3}|…)\s*\]|\.{3}|…/gu, '\n')
    .replace(/([.!?])\s+(?=[\p{Lu}\d"'“‘(\[])/gu, '$1\n');
  return raw.split(/\n+|(?<=[.!?])\s+/u)
    .map(s => s.trim()
      .replace(/^(?:#{1,6}\s*|[-*+]\s+|\d+(?:\.\d+)*\s+)/u, '')
      .replace(/^main article:\s*(?:story\s*)?/iu, '')
      .trim())
    .filter(Boolean);
}

function evidenceTokens(value) {
  return [...new Set(normalizeEvidenceText(value).split(' ').filter(t => t.length >= 4))];
}

function tokenOverlap(a, b) {
  const left = evidenceTokens(a);
  const right = new Set(evidenceTokens(b));
  if (!left.length) return 0;
  return left.filter(t => right.has(t)).length / left.length;
}

function classifyClaimType(claim) {
  const text = normalizeEvidenceText(claim);
  if (/(?:dlaczego|why|powod\w*|przyczyn\w*|motyw\w*|doprowadz\w*|spowod\w*|zmusz\w*|umożliw\w*|umozliw\w*|poniewa[zż]|dlatego|bo |z powodu|w celu|po tym\s*,?\s*jak|wskutek|w efekcie|przez pomylk\w*|przez przypadek|because|due to|therefore|caus\\w*|led to|resulted in|resulting in|so that|accidentally|by mistake)/i.test(text)) return 'causal';
  if (/(?:jak |w jaki sposób|how |sposob\w*|instrukcj\w*|krok\w*|walkthrough|guide)/i.test(text)) return 'procedural';
  if (/(?:kiedy|when |rok\b|data|dzien\w*|today|yesterday|tomorrow)/i.test(text)) return 'temporal';
  if (/(?:gdzie|where |lokacj\w*|miejsce)/i.test(text)) return 'location';
  if (/(?:kto |kim |who |postaci|osob\w*)/i.test(text)) return 'entity';
  if (/(?:ile |how many|how much|cena|liczb\w*|procent)/i.test(text)) return 'quantitative';
  if (/(?:relacj\w*|relationship|związek|zwiazek|partner\w*|różni|rozni|versus|vs\.?)/i.test(text)) return 'relationship';
  return 'factual';
}

function evidenceRelationSignals(value) {
  const text = normalizeEvidenceText(value);
  return {
    causal: /\b(?:bo|poniewaz|gdyz|dlatego|przez|dzieki|because|therefore|accidentally)\b|\bz powodu\b|\b(?:spowod\w*|doprowadz\w*|umozliw\w*|caus\w*|regain\w*|reactivat\w*)\b|\bdue to\b|\bled to\b|\blead\w*(?:\s+\w+){0,3}\s+to\b|\bso that\b|\bso\s+(?:approach|use|avoid|keep|stay|choose|take|do|be)\b|\bby mistake\b|\bodzysk\w*\s+kontrol\w*\b|\buruchom\w*\s+ponownie\b/i.test(text),
    procedural: /\b(?:najpierw|nastepnie|potem|krok\w*|steps?|first|then|after|before|use|uzyj|kliknij|click|walkthrough)\b|\binstrukcj\w*\b/i.test(text),
    temporal: /\b(?:19|20)\d{2}\b|\b(?:(?:stycz|lut|marz|marc|kwiet|kwiec|maj|czerw|lip|sierp|wrzes|pazdz|listopad|grudzi|grudn|grudz)\w*|wczoraj|dzis\w*|jutro|today|yesterday|tomorrow)\b/i.test(text),
    location: /\b(?:w|na|near|located|location|area|region|city|miasto)\b|\b(?:znajduj\w*|lokacj\w*|miejsce\w*)\b/i.test(text),
    relationship: /\b(?:relationship|zwiazk\w*|partner\w*|przyjaz\w*|enemy|wrog\w*|conflict|konflikt\w*|alliance|sojusz\w*)\b/i.test(text),
  };
}

function removeLeadingImageFilenameNoise(value) {
  // Search engines sometimes prepend image alt/file names to the extracted body.
  // Strip only leading filename tokens for candidate ranking; the original source
  // remains unchanged and quote verification still checks against its real content.
  return String(value || '')
    .replace(/^(?:\s*[\p{L}\p{N}_()'’ -]+\.(?:png|jpe?g|webp|gif|svg)\s*)+/iu, '')
    .trim();
}

const CROSS_LANGUAGE_EVIDENCE_CONCEPTS = [
  /\b(?:dragonrend|smocza zguba|smocze przymierze)\b/i,
  /\b(?:dragon\w*|smok\w*)\b/i,
  /\b(?:stay on the ground|on the ground|land\w* on the ground|na ziemi|wyladow\w*)\b/i,
  /\b(?:extended relaxation center|centrum (?:przedluzonego|rozszerzonego) relaksu)\b/i,
  /\b(?:aperture laboratories|laboratori(?:a|ach|ami|ow) aperture)\b/i,
  /\b(?:spellbreaker|lamacz zaklec|zaklinacz spellbreaker|wards?|zaklecia osl\w*|tarcze?\w*)\b/i,
  /\b(?:ranged attacks?|ataki dystansow\w*|bow|luk\w*|far back|high up|at range|na dystans)\b/i,
  /\b(?:on horseback|horseback|mounted|konskiego grzbietu|na koniu|z konia)\b/i,
  /\b(?:giant dogs?|gigantyczn\w*\s+ps\w*|wielkie psy)\b/i,
  /\b(?:cautious\w*|approach cautiously|ostrozn\w*|ostrozne podejscie)\b/i,
  /\b(?:lethal|dangerous|deadly|niebezpiecz\w*|zabojcz\w*)\b/i,
  /\b(?:wild hunt|dziki gon|dzikiego gonu|dzikim gonem)\b/i,
  /\b(?:bloody baron|baron krwawy|barona krwawego|krwawego barona|the baron)\b/i,
  /\b(?:reactivat\w*|turn\w* (?:glados\s+)?back on|uruchom\w* ponownie|wlacz\w* z powrotem)\b/i,
  /\b(?:regain\w* control|regains? control|odzysk\w* kontrol\w*|przejm\w* kontrol\w*)\b/i,
  /\b(?:switch room|room with switches|pomieszczenie z przelacznikami|pokoj z przelacznikami)\b/i,
  /\b(?:accidentally|by mistake|przez pomylk\w*|przez przypadek)\b/i,
  /\b(?:make her behave|zmusz\w*.*zachow\w*|intelligence dampening)\b/i,
];

function sharedEvidenceConceptCount(claim, quote) {
  const claimText = normalizeEvidenceText(claim);
  const quoteText = normalizeEvidenceText(quote);
  return CROSS_LANGUAGE_EVIDENCE_CONCEPTS.filter(pattern => pattern.test(claimText) && pattern.test(quoteText)).length;
}

function rankEvidenceForClaim(claim, blocks, allowedSourceIds = null, limit = 3) {
  const rows = [];
  const claimType = classifyClaimType(claim);
  const claimSignals = evidenceRelationSignals(claim);
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (allowedSourceIds instanceof Set && !allowedSourceIds.has(block.sourceId)) continue;
    const sourceText = removeLeadingImageFilenameNoise(block.content);
    const hasEllipsis = /\[\s*(?:\.{3}|…)\s*\]|\.{3}|…/u.test(sourceText);
    const sentences = splitEvidenceSentences(sourceText);
    for (let i = 0; i < sentences.length; i++) {
      const windows = [sentences[i]];
      // Never join fragments across an omitted span. The separate fragments
      // can still be ranked and verified independently against the source.
      if (!hasEllipsis && sentences[i + 1]) windows.push(sentences[i] + ' ' + sentences[i + 1]);
      for (const quote of windows) {
        if (!quote || quote.length > 350 || /\[\s*(?:\.{3}|…)\s*\]|\.{3}|…/u.test(quote)) continue;
        const lexical = tokenOverlap(claim, quote);
        const semanticMatches = sharedEvidenceConceptCount(claim, quote);
        if (lexical <= 0 && semanticMatches === 0) continue;
        const signals = evidenceRelationSignals(quote);
        let score = lexical + Math.min(0.36, semanticMatches * 0.12);
        if (claimType === 'causal') score += signals.causal ? 0.35 : -0.25;
        if (claimType === 'procedural') score += signals.procedural ? 0.18 : -0.08;
        if (claimType === 'temporal') score += signals.temporal ? 0.15 : -0.05;
        if (claimType === 'location') score += signals.location ? 0.12 : 0;
        if (claimType === 'relationship') score += signals.relationship ? 0.20 : -0.08;
        if (claimType === 'entity' && /\b(?:is|jest|was|był|była|role|postać|character)\b/i.test(quote)) score += 0.08;
        score = Math.max(0, Math.min(1.25, score));
        if (score <= 0) continue;
        rows.push({
          sourceId: block.sourceId,
          title: block.title,
          url: block.url,
          quote,
          score,
          claimType,
          relationMatch: Boolean(claimSignals[claimType] && signals[claimType]),
          semanticMatches,
        });
      }
    }
  }
  rows.sort((a, b) => b.score - a.score || a.quote.length - b.quote.length);
  const seen = new Set();
  return rows.filter(row => {
    const key = row.sourceId + '|' + normalizeEvidenceText(row.quote);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

/**
 * Normalize a source identifier only when it matches an ID already used by the
 * evidence payload. Arbitrary provider IDs and URLs are never converted; IDs must
 * bind to parsed [SOURCE n] or [REFERENCE ...] blocks already present in payload.

 */
function ensureEvidenceSourceId(candidate) {
  const raw = String(candidate?.sourceId ?? candidate?.source_id ?? candidate?.id ?? '').trim();
  const sourceMatch = raw.match(/^SOURCE\s+(\d+)$/i);
  if (sourceMatch) return `SOURCE ${sourceMatch[1]}`;
  const referenceMatch = raw.match(/^REFERENCE\s+([^\]\r\n]+)$/i);
  if (referenceMatch) return `REFERENCE ${referenceMatch[1].trim()}`;
  return null;
}

/**
 * Build and rank verbatim candidates from parsed, authorized source blocks.
 * Quotes are copied from source content and checked again before being returned;
 * they are never generated or paraphrased.

 */
function buildEvidenceCandidatesFromSources(sources, question = '', options = {}) {
  if (!Array.isArray(sources) || !String(question || '').trim()) return [];
  const blocks = sources.map(source => {
    const sourceId = ensureEvidenceSourceId(source);
    if (!sourceId) return null;
    return {
      sourceId,
      title: String(source?.title || ''),
      url: String(source?.url || ''),
      content: String(source?.content || ''),
    };
  }).filter(block => block && block.content.trim());

  const allowedSourceIds = options.allowedSourceIds instanceof Set ? options.allowedSourceIds : null;
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Math.floor(Number(options.limit))) : 3;
  return rankEvidenceForClaim(question, blocks, allowedSourceIds, limit)
    .filter(candidate => {
      const source = blocks.find(block => block.sourceId === candidate.sourceId);
      return source && quoteExists(source.content, candidate.quote);
    })
    .map(candidate => ({
      source_id: candidate.sourceId,
      evidence_quote: candidate.quote,
      title: candidate.title,
      url: candidate.url,
      score: candidate.score,
      claimType: candidate.claimType,
      relationMatch: candidate.relationMatch,
      semanticMatches: candidate.semanticMatches || 0,

    }));
}

function buildEvidenceRepairContext(claims, blocks, allowedSourceIds = null, maxClaims = 4) {
  const rows = [];
  for (const claim of (Array.isArray(claims) ? claims : []).slice(0, maxClaims)) {
    if (!claim?.claim) continue;
    // Repair nie może dostawać przypadkowych fragmentów, które mają tylko
    // pojedyncze wspólne słowo z claimem. Taki materiał zachęca model do
    // dopowiadania niepotwierdzonych przyczyn, motywacji i nazw własnych.
    const claimText = String(claim.claim || '');
    const claimType = classifyClaimType(claimText);
    const claimIsCausal = claimType === 'causal';
    const claimIsSourceMeta = /\b(?:źródł\w*|zrodł\w*|danych|materiał\w*|material\w*|evidence|cytat\w*)\b/i.test(claimText);
    const candidates = buildEvidenceCandidatesFromSources(blocks, claimText, {
      allowedSourceIds,
      limit: 6,
    })
      .filter(candidate => Number(candidate.score) >= 0.10)
      .filter(candidate => !claimIsCausal
        || (candidate.relationMatch && evidenceRelationSignals(candidate.evidence_quote).causal))

      .filter(candidate => !claimIsSourceMeta)
      .slice(0, 2);
    if (!candidates.length) continue;
    rows.push({ claim: String(claim.claim).slice(0, 500), candidates: candidates.map(candidate => ({ source_id: candidate.source_id, evidence_quote: candidate.evidence_quote.slice(0, 500), score: candidate.score })) });
  }
  if (!rows.length) return '';
  const instructions = [
    'REPAIR RULES:',
    '- Split composite statements into atomic claims; each claim must express one independently verifiable fact.',
    '- Every evidence_quote must be one contiguous, verbatim fragment from its cited source.',
    '- Never use ellipses, [...] placeholders, paraphrases, or joined fragments as a quote.',
    '- If candidates support different parts of a claim, split it into separate claims and cite each part independently.',
    '- Remove unsupported advice and finish every sentence; do not leave an example or list unfinished.',
  ].join('\n');
  return instructions + '\n\n' + rows.map((row, index) => [
    'CLAIM ' + (index + 1) + ': ' + row.claim,
    ...row.candidates.map(candidate => [
      'CANDIDATE SOURCE: ' + candidate.source_id,
      'CANDIDATE EVIDENCE QUOTE: ' + candidate.evidence_quote,
      'CANDIDATE SCORE: ' + Number(candidate.score || 0).toFixed(2),
    ].join('\n'))
  ].join('\n')).join('\n\n');
}

function buildQuestionEvidenceContext(question, blocks, allowedSourceIds = null, limit = 6, atomicQuestions = []) {
  const queries = [...new Set(
    (Array.isArray(atomicQuestions) ? atomicQuestions : [])
      .map(value => String(value || '').replace(/\s+/g, ' ').trim())
      .filter(value => value.length >= 8)
  )];
  if (!queries.length) queries.push(String(question || '').replace(/\s+/g, ' ').trim());

  const perQueryLimit = Math.max(1, Math.ceil(limit / Math.min(queries.length, 3)));
  const rows = [];
  const seen = new Set();
  for (const query of queries.slice(0, 3)) {
    for (const candidate of rankEvidenceForClaim(query, blocks, allowedSourceIds, perQueryLimit)) {
      const key = candidate.sourceId + '|' + normalizeEvidenceText(candidate.quote);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...candidate, query });
    }
  }
  rows.sort((a, b) => b.score - a.score || a.quote.length - b.quote.length);
  const selected = rows.slice(0, limit);
  if (!selected.length) return '';

  return selected.map((candidate, index) => {
    const queryLabel = candidate.query && candidate.query !== question
      ? '\nQUESTION PART: ' + candidate.query.slice(0, 300)
      : '';
    return [
      'EVIDENCE CANDIDATE ' + (index + 1) + ': ' + (candidate.sourceId.match(/^REFERENCE\s+/i) ? candidate.sourceId : 'SOURCE ' + candidate.sourceId.replace(/^SOURCE\s+/i, '')),
      queryLabel,
      'QUOTE: ' + candidate.quote.slice(0, 500),
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

module.exports = { escapeUntrustedEvidenceContent, normalizeEvidenceText, parseEvidenceBlocks, quoteExists, splitEvidenceSentences, classifyClaimType, evidenceRelationSignals, rankEvidenceForClaim, ensureEvidenceSourceId, buildEvidenceCandidatesFromSources, buildEvidenceRepairContext, buildQuestionEvidenceContext, removeLeadingImageFilenameNoise, removeLeadingSourceMetadataNoise };
