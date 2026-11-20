// Independent lightweight implementation; no claim of importing Campanula code.
export const unit=n=>typeof n==='number'&&Number.isFinite(n)&&n>=-1&&n<=1;
export function memoryAffect(value){
  if(!value||typeof value!=='object')return null;
  if(typeof value.confidence!=='number'||value.confidence<.85||value.confidence>1)return null;
  const importance=typeof value.importance==='number'&&Number.isFinite(value.importance)?Math.max(0,Math.min(1,value.importance)):.5;
  const mood=value.emotion;
  return {importance,emotion:mood&&unit(mood.valence)&&unit(mood.arousal)&&unit(mood.dominance)
    ?{valence:mood.valence,arousal:mood.arousal,dominance:mood.dominance}:null};
}
export function decayedEmotion(row,at){
  if(!row)return null;
  const decay=Math.exp(-Math.max(0,at-row.at)/21600000);
  if(decay<=.2)return null;
  return {valence:row.valence*decay,arousal:row.arousal*decay,dominance:(row.dominance||0)*decay};
}
export function blendEmotion(previous,next,at){
  const old=decayedEmotion(previous,at);
  return Object.fromEntries(['valence','arousal','dominance'].map(k=>[k,old?old[k]*.6+(next[k]||0)*.4:next[k]||0]));
}
export function memoryClarity(fact,affect,at){
  // Only incidental experiences fade out of the active prompt. Preferences,
  // identity, commitments and operator corrections stay available as before.
  if(affect?.pinned||fact.kind!=='event'||String(fact.sourceId||'').startsWith('manual:'))return 1;
  const importance=affect?.importance??.5,reinforced=Math.min(4,Math.max(0,(affect?.reinforcements||1)-1));
  const halfLifeDays=14+importance*90+reinforced*14;
  return 2**(-Math.max(0,at-fact.at)/(86400000*halfLifeDays));
}
export function memoryRetention(fact,affect,at,{forgetting=true}={}){
  const pinned=Boolean(affect?.pinned)||fact.kind!=='event'||String(fact.sourceId||'').startsWith('manual:');
  const clarity=forgetting?memoryClarity(fact,affect,at):1;
  const stage=pinned?'protected':clarity>=.7?'clear':clarity>=.35?'fading':clarity>=.15?'fuzzy':'archived';
  return {clarity:Math.round(clarity*100)/100,stage,label:{protected:'长期保留',clear:'清晰',fading:'逐渐淡化',fuzzy:'模糊印象',archived:'沉底归档'}[stage],active:clarity>=.15,protected:pinned,pinned:Boolean(affect?.pinned)};
}
export function rankMemories(candidates,affects,{terms,mood,at,explicitRecall=false,forgetting=true}){
  // Relevance remains primary. Affect/repetition can break a tie, never admit
  // unrelated facts or resurrect an expired/forgotten/cross-scope record.
  return candidates.map(f=>{
    const a=affects.get(f.id),matches=new Set(f.terms.filter(t=>terms.includes(t))).size;
    const age=Math.max(0,at-f.at)/86400000;
    const importance=a?.importance??.5;
    const retention=1/(1+age/(30+150*importance));
    const rehearsed=Math.min(1,Math.log2(1+(a?.reinforcements||0))/4);
    const congruence=mood&&a?.emotion?Math.max(0,1-(Math.abs(mood.valence-a.emotion.valence)+Math.abs(mood.arousal-a.emotion.arousal)+Math.abs(mood.dominance-a.emotion.dominance))/6):0;
    const clarity=explicitRecall||!forgetting?1:memoryClarity(f,a,at);
    return {fact:f,clarity,score:matches*10*(.25+.75*clarity)+importance+retention*.5+rehearsed*.3+congruence*.2};
  }).filter(x=>x.clarity>=.15).sort((a,b)=>b.score-a.score||b.fact.at-a.fact.at).map(x=>x.fact);
}
