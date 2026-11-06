'use strict';

const { NIE_CZAS_GRY } = require('./patterns');

const WEB_CATEGORIES = new Set(['weather', 'hltb', 'youtube', 'web_fact']);
const { czyPytanieOLore } = require('./lore');
const { czyPytanieOGameplay } = require('./gameplay');
const { resolveGameEntity, resolveCompanyEntity, czyPytanieOFirmie } = require('./entities');

const SOURCE_TYPES = { weather: 'weather_api', hltb: 'hltb', youtube: 'youtube_api', minecraft_recipe: 'local_minecraft_data' };

function classifyAIRequest(pytanie, policyCategory, recipeDetector = () => false) {
  const text = String(pytanie || '').trim();
  const p = text.toLocaleLowerCase('pl-PL');
  const policyResult = policyCategory(text, recipeDetector);
  const isOpinion = /(?<![\p{L}\p{N}_])(?:czy warto|co (?:myślisz|myslisz|sądzisz)|co sądzisz|co sadzisz|jaka jest twoja opinia|jak oceniasz|polecasz|jest nadal dobre|jest nadal dobry|opłaca się|oplaca sie)(?![\p{L}\p{N}_])/iu.test(p);
  const isPurchaseOpinion = /(?<![\p{L}\p{N}_])(?:czy warto\s+(?:kupić|kupic)|opłaca się\s+(?:kupić|kupic)|oplaca sie\s+(?:kupić|kupic)|polecasz\s+(?:kupić|kupic))(?![\p{L}\p{N}_])/iu.test(p);
  // "Ile trwa walka/misja/aktualizacja…" to nie czas przejścia gry (HowLongToBeat).
  const isHLTB = /(?<![\p{L}\p{N}_])(?:ile\s+(?:jest\s+)?(?:godzin|czasu)|ile\s+godzin\s+(?:ma|zajmuje)|ile\s+trwa|jak\s+d[łl]ugo(?:\s+trwa)?|czas(?:u)?\s+(?:gry|przejścia|przejscia|ukończenia|ukonczenia)|przejście\s+gry|przejscie\s+gry)(?![\p{L}\p{N}_])/iu.test(p)
    && !NIE_CZAS_GRY.test(p);
  const resolvedCompany = resolveCompanyEntity(text);
  const resolvedGame = resolveGameEntity(text);
  const resolved = resolvedCompany || resolvedGame;
  const hasKnownGame = Boolean(resolvedGame && (resolvedGame.type === 'game' || resolvedGame.type === 'franchise' || resolvedGame.game));
  const hasCompanyContext = czyPytanieOFirmie(text);
  const hasKnownCompany = Boolean(resolvedCompany || hasCompanyContext);
  // Opinia o rozpoznanej grze lub firmie może wymagać faktów. Tylko pytanie bez
  // rozpoznanej encji i bez sygnału faktograficznego pozostaje small talkiem.
  const category = isHLTB ? 'hltb' : (isOpinion && hasKnownCompany ? 'web_fact' : (isOpinion && (!hasKnownGame || !isPurchaseOpinion) ? 'conversation' : policyResult));
  const entity = resolved?.game || resolved?.name || detectEntity(p) || null;
  const freshness = detectFreshness(p);
  const isMinecraftRecipe = category === 'minecraft_recipe';
  const lore = !isMinecraftRecipe && czyPytanieOLore(text);
  const gameplay = !isMinecraftRecipe && czyPytanieOGameplay(text);
  const needsWeb = WEB_CATEGORIES.has(category) || lore || gameplay;
  const needsFreshData = freshness === 'live' || freshness === 'recent';
  const sourceType = lore ? 'game_lore' : gameplay ? 'gameplay_guide' : (SOURCE_TYPES[category] || (needsWeb ? 'web_search' : 'none'));
  const questionType = classifyQuestionType(text, { intent: category, is_lore: lore, is_gameplay: gameplay, freshness, game: resolvedGame?.game || (resolvedGame?.type === 'game' ? resolvedGame.name : null) });
  const topicType = classifyTopicType(text, { intent: category, entity_type: resolved?.type || (hasCompanyContext ? 'company' : null), company: resolvedCompany?.name || null, game: resolvedGame?.game || (resolvedGame?.type === 'game' ? resolvedGame.name : null), is_lore: lore, is_gameplay: gameplay });

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
    intent: category, entity, entity_type: resolved?.type || (hasCompanyContext ? 'company' : (entity ? 'entity' : null)),
    game: resolvedGame?.game || (resolvedGame?.type === 'game' ? resolvedGame.name : null), resolved_entity: resolved,
    company: resolvedCompany?.name || null,
    question_type: questionType, topic_type: topicType,
    game_type: resolved?.game_type || null,
    needs_web: needsWeb, needs_fresh_data: needsFreshData, freshness, source_type: sourceType,
    is_lore: lore, is_gameplay: gameplay, confidence,
    confidence_policy: confidence < 0.65 ? 'clarify' : confidence < 0.8 ? 'retrieve_and_guard' : 'normal', query: text,
  };
}

function classifyQuestionType(question, routing = {}) {
  const p = String(question || '').toLocaleLowerCase('pl-PL');
  if (routing.intent === 'conversation') return 'conversation';
  if (routing.intent === 'hltb') return 'duration';
  if (routing.intent === 'weather') return 'forecast';
  if (routing.intent === 'youtube') return 'channel_or_creator';
  if (routing.is_gameplay) return 'how_to';
  if (routing.is_lore) return 'lore';
  if (/(?<![\p{L}\p{N}_])(?:porównaj|porownaj|czym\s+się\s+różni|czym\s+sie\s+rozni|czym\s+różni\s+się|czym\s+rozni\s+sie|różni\p{L}*|rozni\p{L}*|różnica|roznica|vs\.?|versus|lepszy|lepsza|lepsze)(?![\p{L}\p{N}_])/iu.test(p)) return 'comparison';
  if (/(?<![\p{L}\p{N}_])(?:ile\s+kosztuje|jaka\s+cena|cen\p{L}*|kosztuje|za\s+ile|price|how\s+much)(?![\p{L}\p{N}_])/iu.test(p)) return 'price';
  if (/(?<![\p{L}\p{N}_])(?:czy\s+warto|polecasz|opłaca\s+się|oplaca\s+sie|warto\s+kupić|warto\s+kupic|co\s+sądzisz|co\s+sadzisz|co\s+myślisz|co\s+myslisz|jak\s+oceniasz|opinia)(?![\p{L}\p{N}_])/iu.test(p)) return 'recommendation';
  if (/(?<![\p{L}\p{N}_])(?:jak\s+naprawić|jak\s+naprawic|nie\s+działa|nie\s+dziala|nie\s+uruchamia|restart\p{L}*|uruchamia\s+się\s+ponownie|błąd|blad|error|problem|crash|wysypuje\s+się|wysypuje\s+sie)(?![\p{L}\p{N}_])/iu.test(p)) return 'troubleshooting';
  if (/(?<![\p{L}\p{N}_])(?:jak\s+zrobić|jak\s+zrobic|jak\s+skonfigurować|jak\s+skonfigurowac|jak\s+podłączyć|jak\s+podlaczyc|jak\s+użyć|jak\s+uzyc|jak\s+zdobyć|jak\s+zdobyc|jak\s+zainstalować|jak\s+zainstalowac|how\s+to)(?![\p{L}\p{N}_])/iu.test(p)) return 'how_to';
  if (/(?<![\p{L}\p{N}_])(?:dzisiaj|dziś|dzis|teraz|aktualnie|obecnie|najnowsz\p{L}*|ostatni[eao]?\s+wiadomości|news|co\s+nowego)(?![\p{L}\p{N}_])/iu.test(p) || routing.freshness === 'live' || routing.freshness === 'recent') return 'current_info';
  if (/(?<![\p{L}\p{N}_])(?:historia|history|kiedy\s+powstał(?:a|o|y|i)?|kiedy\s+powstal(?:a|o|y|i)?|kiedy\s+założono|kiedy\s+zalozono|pochodzenie|geneza)(?![\p{L}\p{N}_])/iu.test(p)) return 'history';
  if (/(?<![\p{L}\p{N}_])(?:ile\s+osób|ilu\s+użytkowników|ilu\s+uzytkownikow|ile\s+subskrypcji|ile\s+subów|ile\s+subow|liczba\s+użytkowników|liczba\s+uzytkownikow|statystyki|przychód|przychod|obroty|wycena|wartość\s+rynkowa|wartosc\s+rynkowa)(?![\p{L}\p{N}_])/iu.test(p)) return 'statistics';
  if (/(?<![\p{L}\p{N}_])(?:kim\s+jest|kto\s+to\s+jest|who\s+is)(?![\p{L}\p{N}_])/iu.test(p)) return 'identity';
  if (/(?<![\p{L}\p{N}_])(?:co\s+to\s+jest|czym\s+jest|co\s+oznacza|co\s+znaczy|jak\s+działa|jak\s+dziala|na\s+czym\s+polega|wyjaśnij|wyjasnij)(?![\p{L}\p{N}_])/iu.test(p)) return 'explanation';
  if (/(?<![\p{L}\p{N}_])(?:gdzie|dokąd|dokad|lokalizacj\p{L}*|adres)(?![\p{L}\p{N}_])/iu.test(p)) return 'location';
  return 'fact';
}

function classifyTopicType(question, routing = {}) {
  const p = String(question || '').toLocaleLowerCase('pl-PL');
  if (routing.entity_type === 'company' || routing.company || czyPytanieOFirmie(question)) return 'company';
  if (routing.game || routing.entity_type === 'game' || routing.entity_type === 'franchise' || routing.is_lore || routing.is_gameplay) return 'game';
  if (routing.intent === 'weather') return 'weather';
  if (routing.intent === 'youtube') return 'creator_platform';
  if (/(?<![\p{L}\p{N}_])(?:node\.?js|javascript|typescript|python|program\p{L}*|kodzie|api|oauth|serwer\p{L}*|hosting|procesor\p{L}*|gpu|cpu|ram|karta\s+graficzna|rtx|geforce|radeon|playstation|xbox|ps[345]|nintendo|konsol\p{L}*|system\s+operacyjny|linux|windows|android|ios|smartfon|telefon|komputer)(?![\p{L}\p{N}_])/iu.test(p)) return 'technology';
  if (/(?:kim jest|kto to jest|biografia|życiorys|zyciorys)/iu.test(p)) return 'person';
  return 'general';
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
module.exports = { classifyAIRequest, classifyQuestionType, classifyTopicType, detectFreshness, detectEntity };
