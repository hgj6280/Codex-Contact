import {memoryTerms} from './qq-companion.mjs';
import {adjacentSpeakerIds} from './qq-dialogue-context.mjs';

export const QQ_CONTEXT_POLICY=Object.freeze({lookback:120,maxAgeMs:2*60*60*1000,maxMessages:16,charBudget:2800,anchorAgeMs:10*60*1000});
const termsCache=new WeakMap();
export const contextTerms=m=>{const cached=termsCache.get(m);if(cached?.text===m.text)return cached.terms;const value={text:m.text,terms:new Set(memoryTerms(m.text||''))};termsCache.set(m,value);return value.terms;};
const clip=(s,n)=>Array.from(String(s||'').toWellFormed()).slice(0,n).join('');

// Original messages stay in the existing chat store. This small pool and its
// extractive window need neither a local model nor an extra summarizer call.
export function trimContextPool(messages,now){
  return messages.filter(m=>Number.isFinite(m.at)&&m.at<=now&&now-m.at<=QQ_CONTEXT_POLICY.maxAgeMs).slice(-QQ_CONTEXT_POLICY.lookback);
}
export function selectQqContext(messages,event,{now=Date.now(),referenceIds=[]}={}){
  const pool=trimContextPool(messages.filter(m=>m.groupId==null||String(m.groupId)===String(event.groupId)),now),current=String(event.raw?.message_id||'');
  const indexes=new Map(pool.map((m,i)=>[m.id,i])),chosen=new Map();
  const query=new Set(memoryTerms([event.text,event.replyContext?.text].filter(Boolean).join('\n')));
  let size=2;
  function project(m){return {id:m.id,user:m.user,name:clip(m.name,30),text:clip(m.text,160),secondsAgo:Math.max(0,Math.floor((now-m.at)/1000)),
    ...(m.selfReference?{selfReference:true}:{}),...(m.addressedTo?.length?{addressedTo:m.addressedTo}:{}),...(m.quoteAuthor?{quoteAuthor:m.quoteAuthor}:{}),...(m.replyTo?{replyTo:m.replyTo}:{})};}
  function add(i){
    const m=pool[i];if(!m||chosen.has(i)||chosen.size>=QQ_CONTEXT_POLICY.maxMessages)return;
    const row=project(m),cost=JSON.stringify(row).length+(chosen.size?1:0);
    if(size+cost>QQ_CONTEXT_POLICY.charBudget)return;
    chosen.set(i,row);size+=cost;
  }
  function compatible(a,b){
    if(!a||!b)return false;
    if(a.replyTo===b.id||b.replyTo===a.id)return true;
    const targets=m=>(m.addressedTo||[]).map(String).sort().join(',');
    return a.user===b.user&&Math.abs(a.at-b.at)<=90000&&targets(a)===targets(b)&&String(a.quoteAuthor||'')===String(b.quoteAuthor||'');
  }
  // Follow actual quote edges, not arbitrary neighbouring speakers. A small
  // same-speaker continuation is useful, but unrelated parallel topics aren't.
  function thread(i){
    if(i==null)return;
    const visited=new Set();let cursor=i;
    for(let depth=0;cursor!=null&&depth<6&&!visited.has(cursor);depth++){
      visited.add(cursor);add(cursor);const m=pool[cursor];
      if(compatible(m,pool[cursor-1]))add(cursor-1);
      if(compatible(m,pool[cursor+1]))add(cursor+1);
      cursor=m?.replyTo?indexes.get(String(m.replyTo)):undefined;
    }
  }
  add(indexes.get(current));
  const speakerRun=adjacentSpeakerIds(pool,event,now);for(const id of speakerRun) add(indexes.get(id));
  // Keep the latest local antecedents, even when an older bot mention ranks
  // well: otherwise a new "她" could be incorrectly bound to that old mention.
  for(let i=Math.max(0,pool.length-3);i<pool.length;i++)add(i);
  const refs=[event.replyMessageId,event.replyContext?.messageId,...referenceIds].filter(Boolean).map(String);
  for(const id of [...new Set(refs)].slice(0,3))thread(indexes.get(id));
  const ranked=pool.map((m,i)=>{let overlap=0;for(const t of contextTerms(m))if(query.has(t))overlap++;
    return {i,overlap,score:overlap*10+(m.user===String(event.senderId)?1:0)+i/Math.max(1,pool.length)};})
    .filter(x=>x.overlap>0).sort((a,b)=>b.score-a.score);
  for(const x of ranked.slice(0,2))thread(x.i);
  for(let i=Math.max(0,pool.length-6);i<pool.length;i++)if(compatible(pool[i],pool[indexes.get(current)]))add(i);
  for(const x of ranked)add(x.i);
  const rows=[...chosen].sort((a,b)=>a[0]-b[0]).map(([,row])=>row),text=JSON.stringify(rows);
  return {rows,text,stats:{available:pool.length,selected:rows.length,chars:text.length,speakerRun,olderSelected:rows.filter(m=>(indexes.get(m.id)??pool.length)<pool.length-8).length}};
}
