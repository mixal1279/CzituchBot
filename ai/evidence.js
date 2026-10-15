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

function parseEvidenceBlocks(data) {
  const text = String(data || '');
  const re = /^\[(SOURCE \d+|REFERENCE [^\]\r\n]+)\]\s*$/gmi;
  const matches = [...text.matchAll(re)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const block = text.slice(start, end);
    const content = block.match(/TREŚĆ:\s*<<<UNTRUSTED_SOURCE_CONTENT>>>\s*([\s\S]*?)<<<END_UNTRUSTED_SOURCE_CONTENT>>>/i)?.[1] || block;
    return { sourceId: match[1].trim(), title: block.match(/TYTUŁ:\s*([^\r\n]+)/i)?.[1] || '', url: block.match(/URL:\s*(https?:\/\/[^\s\r\n]+)/i)?.[1] || '', content };
  });
}

function quoteExists(sourceContent, quote) {
  const source = normalizeEvidenceText(sourceContent);
  const q = normalizeEvidenceText(quote);
  if (!source || !q || q.length < 3) return false;
  if (source.includes(q)) return true;
  const parts = String(quote)
    .split(/\[\s*(?:\.{3}|…)\s*\]|\.\.\.|…/u)
    .map(normalizeEvidenceText)
    .filter(part => part.split(' ').filter(Boolean).length >= 3);
  return parts.length > 0 && parts.every(part => source.includes(part));
}

function splitEvidenceSentences(text) {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
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
  if (/(?:dlaczego|why|powod\w*|przyczyn\w*|motyw\w*|doprowadz\w*|spowod\w*|umożliw\w*|umozliw\w*|poniewa[zż]|dlatego|bo |z powodu|w celu|because|due to|therefore)/i.test(text)) return 'causal';
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
    causal: /(?:bo|poniewaz|gdyz|dlatego|z powodu|w celu|dzieki|przez|spowod\w*|doprowadz\w*|umozliw\w*|because|therefore|due to|caused|led to|so that)/i.test(text),
    procedural: /(?:najpierw|następnie|nastepnie|potem|krok|steps?|first|then|after|before|use|użyj|uzyj|kliknij|click|instrukcj|walkthrough)/i.test(text),
    temporal: /\b(?:19|20)\d{2}\b|\b(?:(?:stycz|lut|marz|marc|kwiet|kwiec|maj|czerw|lip|sierp|wrzes|pazdz|listopad|grudzi|grudn|grudz)\w*|wczoraj|dzis\w*|jutro|today|yesterday|tomorrow)\b/i.test(text),
    location: /(?:w |na |near |located|znajduj|lokacj|miejsce|location|area|region|city|miasto)/i.test(text),
    relationship: /(?:relationship|związk|zwiazk|partner|przyjaź|przyjaz|enemy|wróg|wrog|conflict|konflikt|alliance|sojusz)/i.test(text),
  };
}

function removeLeadingImageFilenameNoise(value) {
  // Search engines sometimes prepend image alt/file names to the extracted body.
  // Strip only leading filename tokens for candidate ranking; the original source
  // remains unchanged and quote verification still checks against its real content.
  return String(value || '')
    .replace(/^(?:\\s*[\\p{L}\\p{N}_()'’ -]+\\.(?:png|jpe?g|webp|gif|svg)\\s*)+/iu, '')
    .trim();
}

function rankEvidenceForClaim(claim, blocks, allowedSourceIds = null, limit = 3) {
  const rows = [];
  const claimType = classifyClaimType(claim);
  const claimSignals = evidenceRelationSignals(claim);
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (allowedSourceIds instanceof Set && !allowedSourceIds.has(block.sourceId)) continue;
    const sentences = splitEvidenceSentences(removeLeadingImageFilenameNoise(block.content));
    for (let i = 0; i < sentences.length; i++) {
      const windows = [sentences[i]];
      if (sentences[i + 1]) windows.push(sentences[i] + ' ' + sentences[i + 1]);
      for (const quote of windows) {
        const lexical = tokenOverlap(claim, quote);
        if (lexical <= 0) continue;
        const signals = evidenceRelationSignals(quote);
        let score = lexical;
        if (claimType === 'causal') score += signals.causal ? 0.35 : -0.25;
        if (claimType === 'procedural') score += signals.procedural ? 0.18 : -0.08;
        if (claimType === 'temporal') score += signals.temporal ? 0.15 : -0.05;
        if (claimType === 'location') score += signals.location ? 0.12 : 0;
        if (claimType === 'relationship') score += signals.relationship ? 0.20 : -0.08;
        if (claimType === 'entity' && /\b(?:is|jest|was|był|była|role|postać|character)\b/i.test(quote)) score += 0.08;
        score = Math.max(0, Math.min(1.25, score));
        if (score <= 0) continue;
        rows.push({ sourceId: block.sourceId, title: block.title, url: block.url, quote, score, claimType, relationMatch: Boolean(claimSignals[claimType] && signals[claimType]) });
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
    const candidates = rankEvidenceForClaim(claimText, blocks, allowedSourceIds, 6)
      .filter(candidate => Number(candidate.score) >= 0.20)
      .filter(candidate => !claimIsCausal || (candidate.relationMatch && evidenceRelationSignals(candidate.quote).causal))
      .filter(candidate => !claimIsSourceMeta)
      .slice(0, 2);
    if (!candidates.length) continue;
    rows.push({ claim: String(claim.claim).slice(0, 500), candidates: candidates.map(candidate => ({ source_id: candidate.sourceId, evidence_quote: candidate.quote.slice(0, 500), score: candidate.score })) });
  }
  if (!rows.length) return '';
  return rows.map((row, index) => [
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
      'EVIDENCE CANDIDATE ' + (index + 1) + ': SOURCE ' + candidate.sourceId.replace(/^SOURCE\s+/i, ''),
      queryLabel,
      'QUOTE: ' + candidate.quote.slice(0, 500),
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

module.exports = { normalizeEvidenceText, parseEvidenceBlocks, quoteExists, splitEvidenceSentences, classifyClaimType, evidenceRelationSignals, rankEvidenceForClaim, buildEvidenceRepairContext, buildQuestionEvidenceContext, removeLeadingImageFilenameNoise };