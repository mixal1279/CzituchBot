'use strict';

const SOURCE_POLICIES = {
  lore: { preferred: ['official', 'gamelore', 'specialized_wiki', 'reputable_guide'], fallback: ['ign', 'gamespot', 'pcgamer', 'eurogamer', 'fandom'] },
  gameplay: { preferred: ['official', 'gamefaqs', 'specialized_wiki'], fallback: ['ign', 'gamespot', 'pcgamer', 'fandom'] },
  hltb: { preferred: ['hltb'], fallback: [] },
  minecraft_recipe: { preferred: ['local_minecraft_data'], fallback: ['minecraft.wiki'] },
  weather: { preferred: ['weather_api'], fallback: [] },
  youtube: { preferred: ['youtube_api'], fallback: ['twitchtracker', 'twitch'] },
  web_fact: { preferred: ['official', 'specialized', 'reputable'], fallback: ['general_web'] },
  conversation: { preferred: [], fallback: [] },
};

const RESPONSE_PROFILES = {
  simple: { maxSentences: 2, maxWords: 60, maxTokens: 220 },
  comparison: { maxSentences: 4, maxWords: 110, maxTokens: 360 },
  lore: { maxSentences: 7, maxWords: 180, maxTokens: 650 },
  gameplay: { maxSentences: 8, maxWords: 180, maxTokens: 700 },
  timeline: { maxSentences: 8, maxWords: 180, maxTokens: 700 },
  technical: { maxSentences: 6, maxWords: 160, maxTokens: 600 },
  chat: { maxSentences: 3, maxWords: 90, maxTokens: 300 },
};

function detectResponseProfile(question, routing) {
  const p = String(question || '').toLocaleLowerCase('pl-PL');
  if (routing?.is_gameplay) return 'gameplay';
  if (routing?.is_lore) return /\b(?:timeline|chronolog|kolejnoś|kolejnosc|oś czasu|os czasu)\b/i.test(p) ? 'timeline' : 'lore';
  if (/\b(?:porówn|porown|różnic|roznic|vs\.?|versus|lepszy|lepsza|lepsze)\b/i.test(p)) return 'comparison';
  if (/\b(?:kod|api|oauth|docker|node\.?js|javascript|python|program|serwer|błąd|blad|error|config|konfigurac)\b/i.test(p)) return 'technical';
  if (routing?.intent === 'conversation') return 'chat';
  return 'simple';
}

function buildSourcePolicy(routing, responseProfile) {
  const key = routing?.is_lore ? 'lore' : routing?.is_gameplay ? 'gameplay' : routing?.intent || 'web_fact';
  const policy = SOURCE_POLICIES[key] || SOURCE_POLICIES.web_fact;
  return { ...policy, responseProfile, requireEvidence: ['lore', 'gameplay', 'web_fact', 'youtube', 'hltb'].includes(key), freshness: routing?.freshness || 'evergreen' };
}

function planAIRequest(question, routing) {
  const responseProfile = detectResponseProfile(question, routing);
  return {
    intent: routing?.intent || 'conversation',
    entity: routing?.entity || null,
    entityType: routing?.entityType || null,
    game: routing?.game || null,
    freshness: routing?.freshness || 'evergreen',
    needsWeb: Boolean(routing?.needs_web),
    needsFreshData: Boolean(routing?.needs_fresh_data),
    sourceType: routing?.source_type || 'none',
    responseProfile,
    sourcePolicy: buildSourcePolicy(routing, responseProfile),
    claimsRequired: ['lore', 'gameplay'].includes(responseProfile) ? 'claim_by_claim' : 'normal',
  };
}

function responseContract(profile) {
  const cfg = RESPONSE_PROFILES[profile] || RESPONSE_PROFILES.simple;
  return [
    'FORMAT ODPOWIEDZI: maksymalnie ' + cfg.maxSentences + ' zdań i około ' + cfg.maxWords + ' słów.',
    'Zawsze kończ pełne zdania.',
    'Dla pytań gameplay podawaj kolejność działań, jeśli jest potrzebna do wykonania zadania.',
    'Dla pytań lore nie dopowiadaj spoilerów, których nie wymaga pytanie.',
  ].join('\n');
}

module.exports = { SOURCE_POLICIES, RESPONSE_PROFILES, detectResponseProfile, buildSourcePolicy, planAIRequest, responseContract };
