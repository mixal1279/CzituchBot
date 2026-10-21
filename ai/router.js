'use strict';

const { NIE_CZAS_GRY } = require('./patterns');

const WEB_CATEGORIES = new Set(['weather', 'hltb', 'youtube', 'web_fact']);
const { czyPytanieOLore } = require('./lore');
const { czyPytanieOGameplay } = require('./gameplay');
const { resolveGameEntity } = require('./entities');

const SOURCE_TYPES = { weather: 'weather_api', hltb: 'hltb', youtube: 'youtube_api', minecraft_recipe: 'local_minecraft_data' };

function classifyAIRequest(pytanie, policyCategory, recipeDetector = () => false) {
  const text = String(pytanie || '').trim();
  const p = text.toLocaleLowerCase('pl-PL');
  const policyResult = policyCategory(text, recipeDetector);
  const isOpinion = /(?<![\p{L}\p{N}_])(?:czy warto|co (?:myślisz|myslisz|sądzisz)|co sądzisz|co sadzisz|jaka jest twoja opinia|jak oceniasz|polecasz|jest nadal dobre|jest nadal dobry|opłaca się|oplaca sie)(?![\p{L}\p{N}_])/iu.test(p);
  // "Ile trwa walka/misja/aktualizacja…" to nie czas przejścia gry (HowLongToBeat).
  const isHLTB = /(?<![\p{L}\p{N}_])(?:ile\s+(?:jest\s+)?(?:godzin|czasu)|ile\s+godzin\s+(?:ma|zajmuje)|ile\s+trwa|jak\s+d[łl]ugo(?:\s+trwa)?|czas(?:u)?\s+(?:gry|przejścia|przejscia|ukończenia|ukonczenia)|przejście\s+gry|przejscie\s+gry)(?![\p{L}\p{N}_])/iu.test(p)
    && !NIE_CZAS_GRY.test(p);
  const category = isOpinion ? 'conversation' : isHLTB ? 'hltb' : policyResult;
  const resolved = resolveGameEntity(text);
  const entity = resolved?.game || resolved?.name || detectEntity(p) || null;
  const freshness = detectFreshness(p);
  const isMinecraftRecipe = category === 'minecraft_recipe';
  const lore = !isMinecraftRecipe && czyPytanieOLore(text);
  const gameplay = !isMinecraftRecipe && czyPytanieOGameplay(text);
  const needsWeb = WEB_CATEGORIES.has(category) || lore || gameplay;
  const needsFreshData = freshness === 'live' || freshness === 'recent';
  const sourceType = lore ? 'game_lore' : gameplay ? 'gameplay_guide' : (SOURCE_TYPES[category] || (needsWeb ? 'web_search' : 'none'));

  let confidence = 0.65;
  if (category === 'minecraft_recipe') confidence = 0.99;
  else if (category === 'weather' || category === 'hltb' || category === 'youtube') confidence = 0.95;
  else if (category === 'web_fact') confidence = entity ? 0.90 : 0.78;
  else if (lore || gameplay) {
    if (resolved?.resolution === 'deterministic_ambiguous') confidence = Math.min(0.68, Number(resolved.confidence) || 0.68);
    else confidence = resolved ? Math.max(0.86, resolved.confidence) : 0.80;
  } else if (category === 'conversation') confidence = 0.88;

  if (resolved?.resolution === 'deterministic_ambiguous') {
    confidence = Math.min(confidence, 0.68);
  }

  // entity_type opisuje typ DOPASOWANEGO aliasu, nie encji raportowanej.
  // Świadomie nie zmieniamy tego na typ gry: dla pytania „Kim jest Wheatley w
  // Portal 2?” encją raportowaną jest gra, ale odpowiedź dotyczy postaci, a
  // entity_type='game' włączałoby grę jako twardą encję docelową (czituch_bot.js)
  // i odrzucałoby poprawną odpowiedź o postaci. Rozstrzygnięcie „kto jest
  // podmiotem pytania” wymaga osobnej heurystyki — game_type jest raportowane
  // obok, żeby rozbieżność była widoczna w logu.
  return {
    intent: category, entity, entity_type: resolved?.type || (entity ? 'entity' : null),
    game: resolved?.game || (resolved?.type === 'game' ? resolved.name : null), resolved_entity: resolved,
    game_type: resolved?.game_type || null,
    needs_web: needsWeb, needs_fresh_data: needsFreshData, freshness, source_type: sourceType,
    is_lore: lore, is_gameplay: gameplay, confidence,
    confidence_policy: confidence < 0.65 ? 'clarify' : confidence < 0.8 ? 'retrieve_and_guard' : 'normal', query: text,
  };
}
function detectFreshness(p) {
  const S = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';
  // Tylko wyraźne "tu i teraz". "ostatni boss/misja" to zwykłe słowa z gier.
  if (new RegExp(S + '(?:dzisiaj|dziś|dzis|teraz|właśnie|wlasnie|news|wiadomo[śs]\\p{L}*)' + E, 'iu').test(p)) return 'live';
  if (new RegExp(S + '(?:wczoraj|yesterday|obecnie|aktualnie|ostatnio|najnowsz\\p{L}*)' + E, 'iu').test(p)
    || new RegExp(S + 'ostatni(?:e|a|ch)\\s+(?:wiadomo\\p{L}*|aktualizacj\\p{L}*|news\\p{L}*|patch\\p{L}*|update\\p{L}*|wydarzeni\\p{L}*)' + E, 'iu').test(p)) return 'recent';
  if (/\b(?:19\d{2}|20\d{2})\b|(?:^|[^\p{L}])(?:history|histori|pierwsz|wydan|wydany|wydana|powstał|powstała|założon|wynalaz|prototyp|premier|ukazał|ukazała|wyszedł|wyszła)(?![\p{L}])/iu.test(p)) return 'historical';
  return 'evergreen';
}
function detectEntity(p) {
  const patterns = [
    ['YouTube', /\b(?:youtube|youtuber|kanał|kanal|subskryb)\b/i], ['Twitch', /\btwitch\w*/i], ['Kick', /\bkick\w*/i],
    ['Discord', /\bdiscord\w*/i], ['OpenAI', /\b(?:openai|chatgpt|gpt[- ]?\d)\b/i], ['Groq', /\bgroq\b/i],
    ['Gemini', /\bgemini\b/i], ['OpenRouter', /\bopenrouter\b/i],
  ];
  return patterns.find(([, re]) => re.test(p))?.[0] || null;
}
module.exports = { classifyAIRequest, detectFreshness, detectEntity };
