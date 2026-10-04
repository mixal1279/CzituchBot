'use strict';

const WEB_CATEGORIES = new Set(['weather', 'hltb', 'youtube', 'web_fact']);
const { czyPytanieOLore } = require('./lore');
const { czyPytanieOGameplay } = require('./gameplay');

const SOURCE_TYPES = {
  weather: 'weather_api',
  hltb: 'hltb',
  youtube: 'youtube_api',
  minecraft_recipe: 'local_minecraft_data',
};

function classifyAIRequest(pytanie, policyCategory, recipeDetector = () => false) {
  const text = String(pytanie || '').trim();
  const p = text.toLocaleLowerCase('pl-PL');
  const category = policyCategory(text, recipeDetector);

  const entity = detectEntity(p);
  const freshness = detectFreshness(p);
  const needsWeb = WEB_CATEGORIES.has(category);
  const needsFreshData = freshness === 'live' || freshness === 'recent';
  const lore = czyPytanieOLore(text);
  const gameplay = czyPytanieOGameplay(text);
  const sourceType = lore ? 'game_lore' : gameplay ? 'gameplay_guide' : (SOURCE_TYPES[category] || (needsWeb ? 'web_search' : 'none'));

  // Confidence describes routing confidence, not factual confidence.
  let confidence = 0.65;
  if (category === 'minecraft_recipe') confidence = 0.99;
  else if (category === 'weather' || category === 'hltb' || category === 'youtube') confidence = 0.95;
  else if (category === 'web_fact') confidence = entity ? 0.90 : 0.78;
  else if (category === 'conversation') confidence = 0.88;

  return {
    intent: category,
    entity,
    needs_web: needsWeb,
    needs_fresh_data: needsFreshData,
    freshness,
    source_type: sourceType,
    is_lore: lore,
    is_gameplay: gameplay,
    confidence,
    query: text,
  };
}

function detectFreshness(p) {
  if (/\b(dzisiaj|dziś|dzis|teraz|obecnie|aktualnie|właśnie|wlasnie|najnowsz\w*|ostatni\w*|news|wiadomoś\w*|wiadomos\w*)\b/i.test(p)) return 'live';
  if (/\b(wczoraj|yesterday)\b/i.test(p)) return 'recent';
  if (/\b(?:19\d{2}|20\d{2})\b|\b(?:history|histori|pierwsz|wydan|wydany|wydana|powstał|powstała|założon|wynalaz|prototyp|premier|ukazał|ukazała|wyszedł|wyszła)\b/i.test(p)) return 'historical';
  return 'evergreen';
}

function detectEntity(p) {
  const patterns = [
    ['Minecraft', /\bminecraft\b/i],
    ['GTA', /\b(?:gta|grand theft auto)\b/i],
    ['The Witcher', /\b(?:wiedźmin|wiedzmin|witcher|geralt|ciri)\b/i],
    ['Cyberpunk 2077', /\b(?:cyberpunk|night city|johnny silverhand)\b/i],
    ['Red Dead Redemption', /\b(?:red dead|rdr2|arthur morgan)\b/i],
    ['YouTube', /\b(?:youtube|youtuber|kanał|kanal|subskryb)\b/i],
    ['Twitch', /\btwitch\b/i],
    ['Kick', /\bkick\b/i],
    ['Discord', /\bdiscord\b/i],
    ['OpenAI', /\b(?:openai|chatgpt|gpt[- ]?\d)\b/i],
    ['Groq', /\bgroq\b/i],
    ['Gemini', /\bgemini\b/i],
    ['OpenRouter', /\bopenrouter\b/i],
  ];
  return patterns.find(([, re]) => re.test(p))?.[0] || null;
}

module.exports = { classifyAIRequest, detectFreshness, detectEntity };
