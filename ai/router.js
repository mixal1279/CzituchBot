'use strict';

const WEB_CATEGORIES = new Set(['weather', 'hltb', 'youtube', 'web_fact']);
const { czyPytanieOLore } = require('./lore');
const { czyPytanieOGameplay } = require('./gameplay');
const { resolveGameEntity } = require('./entities');

const SOURCE_TYPES = {
  weather: 'weather_api',
  hltb: 'hltb',
  youtube: 'youtube_api',
  minecraft_recipe: 'local_minecraft_data',
};

function classifyAIRequest(pytanie, policyCategory, recipeDetector = () => false) {
  const text = String(pytanie || '').trim();
  const p = text.toLocaleLowerCase('pl-PL');
  const policyResult = policyCategory(text, recipeDetector);
  const isOpinion = /\b(?:czy warto|co (?:myślisz|myslisz|sądzisz|sad zisz)|co sądzisz|co sadzisz|jaka jest twoja opinia|jak oceniasz|polecasz|jest nadal dobre|jest nadal dobry|opłaca się|oplaca sie)\b/i.test(p);
  const isHLTB = /\b(?:ile\s+(?:jest\s+)?(?:godzin|czasu)|ile\s+godzin\s+(?:ma|zajmuje)|ile\s+trwa|jak\s+d[łl]ugo(?:\s+trwa)?|czas(?:u)?\s+(?:gry|przejścia|przejscia|ukończenia|ukonczenia)|przejście\s+gry|przejscie\s+gry)\b/i.test(p);
  const category = isOpinion ? 'conversation' : isHLTB ? 'hltb' : policyResult;
  const resolved = resolveGameEntity(text);
  const entity = resolved?.game || resolved?.name || detectEntity(p) || null;
  const freshness = detectFreshness(p);
  const isMinecraftRecipe = category === 'minecraft_recipe';
  const lore = !isMinecraftRecipe && czyPytanieOLore(text);
  const gameplay = !isMinecraftRecipe && czyPytanieOGameplay(text);

  // Lore/gameplay zawsze potrzebują retrievalu, nawet gdy policy zwróci conversation.
  const needsWeb = WEB_CATEGORIES.has(category) || lore || gameplay;
  const needsFreshData = freshness === 'live' || freshness === 'recent';
  const sourceType = lore ? 'game_lore' : gameplay ? 'gameplay_guide' : (SOURCE_TYPES[category] || (needsWeb ? 'web_search' : 'none'));

  let confidence = 0.65;
  if (category === 'minecraft_recipe') confidence = 0.99;
  else if (category === 'weather' || category === 'hltb' || category === 'youtube') confidence = 0.95;
  else if (category === 'web_fact') confidence = entity ? 0.90 : 0.78;
  else if (lore || gameplay) confidence = resolved ? Math.max(0.86, resolved.confidence) : 0.80;
  else if (category === 'conversation') confidence = 0.88;

  return {
    intent: category,
    entity,
    entity_type: resolved?.type || (entity ? 'entity' : null),
    game: resolved?.game || (resolved?.type === 'game' ? resolved.name : null),
    resolved_entity: resolved,
    needs_web: needsWeb,
    needs_fresh_data: needsFreshData,
    freshness,
    source_type: sourceType,
    is_lore: lore,
    is_gameplay: gameplay,
    confidence,
    confidence_policy: confidence < 0.65 ? 'clarify' : confidence < 0.8 ? 'retrieve_and_guard' : 'normal',
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
  // Gry i postacie są rozwiązywane przez resolveGameEntity(), więc nie
  // utrzymujemy tutaj drugiej, rozjeżdżającej się listy aliasów.
  const patterns = [
    ['YouTube', /\b(?:youtube|youtuber|kanał|kanal|subskryb)\b/i],
    ['Twitch', /\btwitch\w*/i],
    ['Kick', /\bkick\w*/i],
    ['Discord', /\bdiscord\w*/i],
    ['OpenAI', /\b(?:openai|chatgpt|gpt[- ]?\d)\b/i],
    ['Groq', /\bgroq\b/i],
    ['Gemini', /\bgemini\b/i],
    ['OpenRouter', /\bopenrouter\b/i],
  ];
  return patterns.find(([, re]) => re.test(p))?.[0] || null;
}

module.exports = { classifyAIRequest, detectFreshness, detectEntity };
