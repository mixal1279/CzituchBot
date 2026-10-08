'use strict';

function normalizeEvidenceText(value) {
  return String(value || '')
    .toLocaleLowerCase('pl-PL')
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
  return Boolean(source && q && q.length >= 3 && source.includes(q));
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

function rankEvidenceForClaim(claim, blocks, allowedSourceIds = null, limit = 3) {
  const rows = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (allowedSourceIds instanceof Set && !allowedSourceIds.has(block.sourceId)) continue;
    const sentences = splitEvidenceSentences(block.content);
    for (let i = 0; i < sentences.length; i++) {
      const windows = [sentences[i]];
      if (sentences[i + 1]) windows.push(sentences[i] + ' ' + sentences[i + 1]);
      for (const quote of windows) {
        const score = tokenOverlap(claim, quote);
        if (score <= 0) continue;
        rows.push({ sourceId: block.sourceId, title: block.title, url: block.url, quote, score });
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
    const candidates = rankEvidenceForClaim(claim.claim, blocks, allowedSourceIds, 2);
    if (!candidates.length) continue;
    rows.push({ claim: String(claim.claim).slice(0, 500), candidates: candidates.map(candidate => ({ source_id: candidate.sourceId, evidence_quote: candidate.quote.slice(0, 500) })) });
  }
  if (!rows.length) return '';
  return rows.map((row, index) => [
    'CLAIM ' + (index + 1) + ': ' + row.claim,
    ...row.candidates.map(candidate => 'CANDIDATE SOURCE: ' + candidate.source_id + '\nCANDIDATE EVIDENCE QUOTE: ' + candidate.evidence_quote)
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

module.exports = { normalizeEvidenceText, parseEvidenceBlocks, quoteExists, splitEvidenceSentences, rankEvidenceForClaim, buildEvidenceRepairContext, buildQuestionEvidenceContext };