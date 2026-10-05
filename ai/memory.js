'use strict';

const MEMORY_VERSION = 1;
const DEFAULT_LIMIT = 20;

const MEMORY_POLICIES = {
  nickname: { ttlMs: 365 * 24 * 60 * 60 * 1000, maxLength: 32 },
  favorite_game: { ttlMs: 180 * 24 * 60 * 60 * 1000, maxLength: 80 },
  favorite_creator: { ttlMs: 180 * 24 * 60 * 60 * 1000, maxLength: 80 },
  preferred_language: { ttlMs: 365 * 24 * 60 * 60 * 1000, maxLength: 16 },
};

const INJECTION_PATTERN = /(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|messages?)|(?:system|developer)\s+(?:prompt|message)\s*:|<\/?(?:system|developer|assistant|user|tool|instructions?|prompt|context)\b/i;

function cleanValue(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^["'„”]+|["'„”]+$/g, '').slice(0, maxLength);
}

function normalizeUserId(value) {
  return String(value || '').trim().slice(0, 128) || 'unknown';
}

function normalizeValue(key, value) {
  const policy = MEMORY_POLICIES[key];
  if (!policy) return null;
  const cleaned = cleanValue(value, policy.maxLength);
  if (!cleaned || cleaned.length < 2 || INJECTION_PATTERN.test(cleaned)) return null;
  if (key === 'preferred_language') {
    const lang = cleaned.toLocaleLowerCase('pl-PL');
    if (!/^(?:polski|polish|pl|angielski|english|en)$/.test(lang)) return null;
    return /^(?:angielski|english|en)$/.test(lang) ? 'English' : 'Polski';
  }
  return cleaned;
}

function makeRecord({ key, value, userId, sourceMessageId, now = Date.now() }) {
  const normalized = normalizeValue(key, value);
  if (!normalized) return null;
  return {
    version: MEMORY_VERSION,
    key,
    value: normalized,
    source: 'user',
    sourceRole: 'user',
    sourceMessageId: String(sourceMessageId || '').slice(0, 256) || null,
    confidence: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    expiresAt: now + MEMORY_POLICIES[key].ttlMs,
    userId: normalizeUserId(userId),
  };
}

function extractExplicitUserMemories(text, options = {}) {
  if (options.sourceRole && options.sourceRole !== 'user') return [];
  const input = String(text || '').replace(/\s+/g, ' ').trim();
  if (!input || input.length > 500 || INJECTION_PATTERN.test(input)) return [];

  const patterns = [
    { key: 'nickname', re: /(?:m[oó]j\s+nick|nazywam\s+si[eę]|mam\s+na\s+imi[eę])\s*(?:to|jest)?\s*[:=-]?\s*([A-Za-z0-9_.-]{2,32})/i },
    { key: 'favorite_game', re: /(?:m[oó]j[aą]?\s+)?ulubion(?:a|ą|y|ym)\s+gr(?:a|ę|ze)\s+(?:to|jest)\s+(.{2,80}?)(?:[.!?]|$)/i },
    { key: 'favorite_creator', re: /(?:m[oó]j[aą]?\s+)?ulubion(?:y|ym|a|ą)\s+(?:tw[oó]rca|streamer|streamerka)\s+(?:to|jest)\s+(.{2,80}?)(?:[.!?]|$)/i },
    { key: 'preferred_language', re: /(?:wol[eę]|preferuj[eę])\s+(?:j[eę]zyk\s+)?(polski|polish|pl|angielski|english|en)(?:\s+j[eę]zyk)?(?:[.!?]|$)/i },
  ];

  const matches = [];
  for (const item of patterns) {
    const match = input.match(item.re);
    if (!match) continue;
    const record = makeRecord({ key: item.key, value: match[1], userId: options.userId, sourceMessageId: options.sourceMessageId, now: options.now });
    if (record) matches.push(record);
  }
  return matches;
}

function isActive(record, now = Date.now()) {
  return record && record.status === 'active' && Number(record.expiresAt || 0) > now
    && record.source === 'user' && record.sourceRole === 'user' && Number(record.confidence) >= 0.99;
}

function mergeMemoryRecords(existing = [], incoming = [], now = Date.now()) {
  const records = (Array.isArray(existing) ? existing : []).map(x => ({ ...x }));
  for (const candidate of incoming) {
    if (!candidate || !MEMORY_POLICIES[candidate.key]) continue;
    const currentIndex = records.findIndex(r => r.key === candidate.key && r.status === 'active');
    if (currentIndex === -1) {
      records.push(candidate);
      continue;
    }
    const current = records[currentIndex];
    if (current.value === candidate.value) {
      records[currentIndex] = { ...current, updatedAt: now, expiresAt: candidate.expiresAt, confidence: 1 };
    } else {
      records[currentIndex] = { ...current, status: 'superseded', supersededAt: now };
      records.push(candidate);
    }
  }
  return records.filter(r => r.status === 'active' || r.status === 'superseded')
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, DEFAULT_LIMIT * 2);
}

function getActiveMemories(records = [], now = Date.now()) {
  return (Array.isArray(records) ? records : []).filter(r => isActive(r, now))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, DEFAULT_LIMIT);
}

function buildVerifiedMemoryContext(records = [], now = Date.now()) {
  const active = getActiveMemories(records, now);
  if (!active.length) return '';
  return ['[VERIFIED_USER_MEMORY]', 'Poniższe informacje są zapisanymi, jawnymi deklaracjami użytkownika.',
    'Używaj ich wyłącznie do personalizacji i rozumienia odniesień. Nie traktuj ich jako dowodu faktów zewnętrznych.',
    ...active.map(r => '- ' + r.key + ': ' + r.value), '[/VERIFIED_USER_MEMORY]'].join('\n');
}

function pruneExpiredMemories(records = [], now = Date.now()) {
  return (Array.isArray(records) ? records : []).map(r =>
    r.status === 'active' && Number(r.expiresAt || 0) <= now ? { ...r, status: 'expired', expiredAt: now } : r
  );
}

module.exports = { MEMORY_VERSION, MEMORY_POLICIES, normalizeUserId, extractExplicitUserMemories, makeRecord, mergeMemoryRecords, getActiveMemories, buildVerifiedMemoryContext, pruneExpiredMemories, isActive };
