'use strict';

const { buildRetrievalPlan: buildCoreRetrievalPlan } = require('./core');

function selectRetrievalQueries({
  atomicQueries = [],
  causalQuery = null,
  specializedQueries = [],
  fallbackQueries = [],
  maxQueries = 3,
} = {}) {
  const limit = Math.max(0, Math.min(3, Math.floor(Number(maxQueries) || 0)));
  const selected = [];
  const seen = new Set();
  const add = value => {
    const query = String(value || '').replace(/\s+/g, ' ').trim();
    const key = query.toLocaleLowerCase('pl-PL');
    if (query.length < 8 || seen.has(key) || selected.length >= limit) return;
    seen.add(key);
    selected.push(query);
  };

  // A causal query already contains the original question. Give it and one
  // profile-specific query priority, so atomic sub-questions cannot crowd out
  // the evidence most likely to answer the actual intent.
  if (causalQuery) add(causalQuery);
  else add((Array.isArray(atomicQueries) ? atomicQueries : [])[0]);
  add((Array.isArray(specializedQueries) ? specializedQueries : [])[0]);
  for (const query of Array.isArray(atomicQueries) ? atomicQueries : []) add(query);
  for (const query of Array.isArray(specializedQueries) ? specializedQueries : []) add(query);
  for (const query of Array.isArray(fallbackQueries) ? fallbackQueries : []) add(query);
  return selected;
}

function isMultiPartQuestion(question) {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  if (!q) return false;
  const interrogatives = q.match(/(?<![\p{L}])(?:kto|kim|co|czym|jaki|jaka|jakie|dlaczego|czemu|kiedy|gdzie|ile|czy|jak)(?![\p{L}])/giu) || [];
  return interrogatives.length >= 2 || decomposeQuestion(q).length >= 2;
}
function unique(items){const out=[],seen=new Set();for(const item of Array.isArray(items)?items:[]){const q=String(item||'').replace(/\s+/g,' ').trim(),k=q.toLocaleLowerCase('pl-PL');if(q.length>=8&&!seen.has(k)){seen.add(k);out.push(q);}}return out;}
function decomposeQuestion(question,routing={}) {
  const q=String(question||'').replace(/\s+/g,' ').trim();
  if(!q) return [];
  const entity=String(routing.resolved_entity?.name||routing.entity||routing.game||'').trim();
  const game=String(routing.resolved_entity?.game||routing.game||'').trim();
  const anchor=[entity,game].filter(Boolean).filter((v,i,a)=>a.findIndex(x=>x.toLocaleLowerCase('pl-PL')===v.toLocaleLowerCase('pl-PL'))===i);
  const clauses=[];
  const push=(value)=>{
    const v=String(value||'').replace(/^\s*(?:i|oraz|a także|natomiast)\s+/i,'').replace(/[?]+$/,'').trim();
    if(v.length>=12 && !clauses.some(x=>x.toLocaleLowerCase('pl-PL')===v.toLocaleLowerCase('pl-PL'))) clauses.push(v);
  };
  // Split only at conjunctions that introduce a new interrogative clause. This
  // avoids the previous cumulative-prefix bug (clause 2 inherited clause 1).
  const parts=q.split(/\s+(?=(?:i|oraz|a także|natomiast)\s+(?:jak|dlaczego|czemu|kiedy|gdzie|ile|czy|kto|kim|co|czym|jaki|jaka|jakie)\b)/iu);
  if(parts.length>1){
    for(const part of parts.slice(0,3)) push(part);
  } else {
    const commaParts=q.split(/,\s*(?=(?:jak|dlaczego|czemu|kiedy|gdzie|ile|czy|kto|kim|co|czym|jaki|jaka|jakie)\b)/iu);
    if(commaParts.length>1) for(const part of commaParts.slice(0,3)) push(part);
  }
  if(clauses.length<2){
    const questionMarks=q.split(/\?+/).map(x=>x.trim()).filter(Boolean);
    if(questionMarks.length>1) questionMarks.slice(0,3).forEach(push);
  }
  if(clauses.length<2) return [];
  return clauses.slice(0,3).map((clause,index)=>{
    if(index===0) return clause;
    const normalized=clause.toLocaleLowerCase('pl-PL');
    const previousEntities = extractCarryoverEntities(clauses.slice(0,index).join(' '));
    const carry = [...previousEntities, ...anchor]
      .filter(Boolean)
      .filter((v,i,a)=>a.findIndex(x=>x.toLocaleLowerCase('pl-PL')===v.toLocaleLowerCase('pl-PL'))===i)
      .filter(v=>!normalized.includes(v.toLocaleLowerCase('pl-PL')))
      .slice(0,4);
    return carry.length ? [...carry,clause].join(' ') : clause;
  });
}
function extractCarryoverEntities(text) {
  const stop = new Set(['jaki','jaka','jakie','który','która','które','kim','kto','co','czym','dlaczego','czemu','kiedy','gdzie','ile','czy','jak']);
  const matches = String(text || '').match(/(?<![\p{L}\p{N}_])[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'’.-]*){0,3}/gu) || [];
  return [...new Set(matches
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => {
      const first = x.toLocaleLowerCase('pl-PL').split(/\s+/)[0];
      return !stop.has(first) && x.length >= 3;
    }))].slice(0, 3);
}
function buildAdvancedRetrievalPlan(question, routing = {}, baseQueries = []) {
  const corePlan = buildCoreRetrievalPlan(question, routing, { maxQueries: 5 });
  const clausePlan = decomposeQuestion(question, routing).map((query, index) => ({
    query,
    priority: index === 0 ? 'primary' : 'secondary',
    reason: 'clause',
  }));
  const legacy = Array.isArray(baseQueries) ? baseQueries : [];
  const merged = [];
  const seen = new Set();
  // Clause queries are reserved first so compound questions cannot lose a
  // sub-question when the global five-query cap is applied.
  for (const item of [...clausePlan, ...corePlan, ...legacy.map(query => ({ query, priority: 'fallback', reason: 'legacy' }))]) {
    const q = String(item?.query || '').replace(/\s+/g, ' ').trim();
    const key = normalizujToken(q);
    if (q.length < 8 || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      query: q,
      priority: item.priority || (merged.length === 0 ? 'primary' : 'fallback'),
      reason: item.reason || 'coverage',
    });
  }
  return merged.slice(0, 5);
}
function normalizujToken(value) {
  return String(value || '').toLocaleLowerCase('pl-PL')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ').trim();
}

// Build supplemental searches only from the original question and its resolved game.
// Unsupported claims are intentionally excluded: a rejected model claim may contain
// a hallucinated location or even details from a different game.
function buildSupplementalRetrievalQuery(question, routing = {}, causalQuestion = false) {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  if (!q) return '';
  const game = String(routing.resolved_entity?.game || routing.game || '').replace(/\s+/g, ' ').trim();
  const hasGame = game && normalizujToken(q).includes(normalizujToken(game));
  const anchor = game && !hasGame ? game : '';
  const intent = causalQuestion ? 'cause reason motivation' : 'guide walkthrough location';
  return [anchor, q, intent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function sourceHost(url){try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch(_){return '';}}
function sourceQualityScore(source = {}) {
  const score = Number(source.score);
  const authority = String(source.authority || '').toLocaleLowerCase('pl-PL');
  // core.js emits canonical English enum values; accept legacy Polish labels too.
  const authorityBonus = authority === 'official' || authority === 'oficjalne'
    ? 0.25
    : ['specialized', 'wyspecjalizowane', 'reference'].includes(authority)
      ? 0.2
      : authority.includes('guide') || authority === 'guide/referencyjne' || authority.includes('poradnik')
        ? 0.08
        : 0;
  return (Number.isFinite(score) ? score : 0) + authorityBonus;
}
function sourceTokens(source={}){return [...new Set(String([source.title,source.content,source.snippet].filter(Boolean).join(' ')).toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]{3,}/gu)||[])];}
function sourceDiversity(results=[]){const list=Array.isArray(results)?results:[];const hosts=new Set(list.map(r=>sourceHost(r?.url)).filter(Boolean));const providers=new Set(list.map(r=>String(r?.provider||'')).filter(Boolean));const independent=[];let duplicatePairs=0;
for(const result of list){const tokens=sourceTokens(result);const tokenSet=new Set(tokens);let duplicate=false;for(const prior of independent){const priorTokens=prior.tokens;if(tokens.length<8||priorTokens.length<8)continue;const smaller=Math.min(tokens.length,priorTokens.length);const common=tokens.filter(t=>prior.set.has(t)).length;const containment=common/smaller;const union=new Set([...tokens,...priorTokens]).size;const jaccard=union?common/union:0;if(containment>=0.88&&jaccard>=0.72){duplicate=true;duplicatePairs++;break;}}if(!duplicate)independent.push({host:sourceHost(result?.url),tokens,set:tokenSet});}
const independentHosts=new Set(independent.map(x=>x.host).filter(Boolean));return {hosts:hosts.size,providers:providers.size,independentSources:independent.length,independentHosts:independentHosts.size,duplicatePairs};}
function shouldRunAdditionalRetrieval({status='ok',text='',sourceCount=0,queryCount=1,results=[],requireDiversity=false}={}){const list=Array.isArray(results)?results:[];if(status!=='ok'||!String(text).trim()||String(text).length<900||sourceCount<2)return true;if(requireDiversity){const d=sourceDiversity(list);if(d.independentHosts<2)return true;}const strong=list.filter(r=>sourceQualityScore(r)>=0.55).length;if(strong<1)return true;return false;}
function rankRetrievalNeed({routing={},sourceCount=0,textLength=0,validatorStatus=null,results=[]}={}){let score=0;if(routing.needs_fresh_data)score+=3;if(routing.is_lore||routing.is_gameplay)score+=2;if(sourceCount<2)score+=2;if(textLength<900)score++;if(validatorStatus==='rejected'||validatorStatus==='inconclusive')score+=3;const d=sourceDiversity(results);if(sourceCount>=2&&d.independentHosts<2)score+=2;return score>=5?'high':score>=3?'medium':'low';}
module.exports={decomposeQuestion,isMultiPartQuestion,extractCarryoverEntities,buildAdvancedRetrievalPlan,buildSupplementalRetrievalQuery,selectRetrievalQueries,shouldRunAdditionalRetrieval,rankRetrievalNeed,sourceDiversity,sourceQualityScore,normalizujToken};
