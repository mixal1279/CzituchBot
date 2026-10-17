'use strict';
const DEFAULTS={maxQuestionChars:500,maxHistoryMessages:8,maxReferenceChars:10000,maxMemoryRecords:20,requestTimeoutMs:40000,maxModelCalls:12,maxGenerations:6,maxInitialGenerations:5,maxRepairGenerations:4,maxValidators:4,maxTavilySearches:3};
function createRequestBudget(overrides={}){const c={...DEFAULTS,...overrides},startedAt=Date.now();return{startedAt,...c,modelCalls:0,generations:0,validators:0,tavilySearches:0,expired(){return Date.now()-startedAt>=c.requestTimeoutMs;},reserve(type){const map={modelCalls:'modelCalls',generation:'generations',validator:'validators',tavily:'tavilySearches'},key=map[type];if(!key||this.expired()||this[key]>=c['max'+key.charAt(0).toUpperCase()+key.slice(1)])return false;this[key]++;return true;}};}
function sanitizeRequestText(text,maxChars=DEFAULTS.maxQuestionChars){
  // Znaki niewidoczne (zero-width, bidi) służą do ukrywania instrukcji; wycinamy je tak jak w danych ze stron.
  const cleaned=String(text||'').replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g,'').replace(/[\u0000-\u001F\u007F]/g,' ').trim();
  if(cleaned.length<=maxChars)return cleaned;
  let cut=cleaned.slice(0,maxChars);
  // Nie rozcinamy pary zastępczej (emoji), bo zostałby niepoprawny znak UTF-16 w żądaniu do API.
  if(/[\uD800-\uDBFF]$/.test(cut))cut=cut.slice(0,-1);
  return cut;
}
module.exports={DEFAULTS,createRequestBudget,sanitizeRequestText};