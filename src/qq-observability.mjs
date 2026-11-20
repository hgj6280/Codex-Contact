// Only numeric measurements and fixed labels leave a request. Prompt fragments
// are matched in memory against the final payload (after clipping/expansion).
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {closeSync,openSync} from 'node:fs';

const context=new AsyncLocalStorage();
export const roles=['context','emotion','vision','sticker','memory','reply','social','summary','image_generation','other','unclassified'];
const groups=['rules','history','other','images','unattributed'];
const millis=value=>Number.isSafeInteger(value)&&value>0?value:null;
export function withReplyTrace(headers,work){
  const started=Date.now();
  const read=name=>{const n=Number(headers[name]);return millis(n)&&n<=started?n:null;};
  const received=read('x-qq-received-ms'),queued=read('x-qq-enqueued-ms');
  const trace={id:randomUUID(),receivedAt:received,queuedAt:received&&queued>=received?queued:null,
    hubAt:started,contextAt:null,firstOutputAt:null,lastOutputAt:null,attempts:0,parts:new Map()};
  return context.run(trace,async()=>{
    try{return await work();}
    finally{trace.parts.clear();}
  });
}
// Queue consumers may run on the previous job's promise chain. Carry only
// numeric timestamps between jobs, never another chat's prompt fragments.
export function taskOrigin(){
  const s=context.getStore();
  return s?{received:s.receivedAt,queued:s.queuedAt,replyId:s.id}:null;
}
export function withTaskTrace(origin,work){
  const headers={'x-qq-received-ms':origin?.received,'x-qq-enqueued-ms':origin?.queued};
  return withReplyTrace(headers,()=>{
    context.getStore().parentId=origin?.replyId??null;
    markContextStart();
    return work();
  });
}
export function bindTrace(work){
  const trace=context.getStore();
  return ()=>context.run(trace,work);
}
export function markContextStart(){const s=context.getStore();if(s)s.contextAt??=Date.now();}
export function promptPart(kind,value){
  const s=context.getStore();
  if(s && typeof value==='string' && value.length && value.length<=128000 && s.parts.size<128)s.parts.set(value,kind);
  return value;
}
export function callMetadata({prompt='',role='other',retry=false,imageCount=0,sharedRoles=[],systemBytes=0,historySuffixBytes=null}={}){
  // The background memory worker batches multiple turns and can wake on a
  // timer created by another chat. It has no single originating reply.
  const s=role==='memory'?null:context.getStore();
  const bytes=Buffer.byteLength(prompt);
  const weights={rules:0,history:0,other:bytes};
  // A formatted rule block can itself contain retrieved history. Measure
  // the union of intervals and prefer the embedded history at overlaps.
  const ranges=[];
  const cuts=new Set([0,prompt.length]);
  for(const [part,kind] of s?.parts||[]){
    const start=prompt.indexOf(part);
    if(start<0)continue;
    const end=start+part.length;
    ranges.push({start,end,kind});cuts.add(start);cuts.add(end);
  }
  const edges=[...cuts].sort((a,b)=>a-b);
  for(let i=1;i<edges.length;i++){
    const lo=edges[i-1],hi=edges[i];
    const matching=ranges.filter(r=>r.start<=lo&&r.end>=hi);
    if(!matching.length)continue;
    const kind=matching.some(r=>r.kind==='history')?'history':'rules';
    const n=Buffer.byteLength(prompt.slice(lo,hi));
    weights[kind]+=n;weights.other-=n;
  }
  if(Number.isSafeInteger(historySuffixBytes)&&historySuffixBytes>=0&&historySuffixBytes<=bytes){
    weights.history=historySuffixBytes;
    weights.rules=bytes-historySuffixBytes;
    weights.other=0;
  }
  weights.rules+=systemBytes;
  return {sharedRoles:sharedRoles.filter(r=>roles.includes(r)&&r!==role),role:roles.includes(role)?role:'other',replyId:s?.id??null,retry:Boolean(retry),imageCount,visibleBytes:weights};
}
export function splitInput(tokens,meta,reportedImages){
  const split=Object.fromEntries(groups.map(k=>[k,0]));
  const imageKnown=Number.isSafeInteger(reportedImages)&&reportedImages>=0&&reportedImages<=tokens;
  if(meta.imageCount&&!imageKnown)return {...split,images:null,unattributed:tokens};
  split.images=imageKnown?reportedImages:0;
  const bytes=meta.visibleBytes||{},total=(bytes.rules||0)+(bytes.history||0)+(bytes.other||0),remaining=tokens-split.images;
  if(!total){split.unattributed=remaining;return split;}
  split.rules=Math.floor(remaining*bytes.rules/total);
  split.history=Math.floor(remaining*bytes.history/total);
  split.other=remaining-split.rules-split.history;
  return split;
}
export function modelObservation(meta,{first=null,last=null}={}){
  const s=context.getStore();
  if(!s||s.id!==meta.replyId||!['reply','vision','image_generation','context','summary','sticker','social'].includes(meta.role))return;
  if(millis(first)&&(!s.firstOutputAt||first<s.firstOutputAt))s.firstOutputAt=first;
  if(millis(last)&&(!s.lastOutputAt||last>s.lastOutputAt))s.lastOutputAt=last;
}
function replyTimingRow(ok,sendIndex,now=Date.now()){
  const s=context.getStore();
  if(!s)return null;
  const {id,receivedAt,queuedAt,hubAt,contextAt,firstOutputAt,lastOutputAt}=s;
  const values=[receivedAt,queuedAt,contextAt,firstOutputAt,lastOutputAt,ok?now:null];
  const durations=values.slice(1).map((t,i)=>t!=null&&values[i]!=null&&t>=values[i]?t-values[i]:null);
  return {id,parentId:s.parentId??null,sendIndex,status:ok?'sent':'unconfirmed',receivedAt,queuedAt,hubAt,contextAt,firstOutputAt,lastOutputAt,
    receiptAt:ok?now:null,stageMs:durations,totalMs:ok&&receivedAt!=null?now-receivedAt:null};
}
export function createReplyTimings(file){
  let db,insert,warned=false;
  function open(){
    if(insert)return;
    closeSync(openSync(file,'a',0o600));
    db=new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS replies(n INTEGER PRIMARY KEY,reply_id TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS reply_trace_id ON replies(reply_id)');
    insert=db.prepare('INSERT INTO replies(reply_id,data) VALUES(?,?)');
  }
  return {
    recent(){
      open();
      return db.prepare('SELECT data FROM replies ORDER BY n DESC LIMIT 100').all().map(r=>JSON.parse(r.data));
    },
    save(row){
      if(!row)return;
      try{
        open();
        insert.run(row.id,JSON.stringify(row));
      }catch{
        if(!warned)console.warn('QQ timing record unavailable');
        warned=true;
      }
    }
  };
}

// Observe only native sends. Read a cloned, small receipt so the normal caller
// keeps ownership of its response, timeout, error and body.
export function observeSends(transport,save){
  return async (url,options)=>{
    if(!/\/(?:desktop\/)?send_(?:group|private)_msg$/.test(String(url)))return transport(url,options);
    const observed=async()=>{
      const sendIndex=++context.getStore().attempts;
      let response;
      try {response=await transport(url,options);}
      catch(error){save(replyTimingRow(false,sendIndex));throw error;}
      try{
        response.clone().json().then(body=>save(replyTimingRow(response.ok&&body.status==='ok'&&body.retcode===0&&body.data?.message_id!=null,sendIndex)),()=>save(replyTimingRow(false,sendIndex)));
      }catch{/* Metrics cannot abort delivery. */}
      return response;
    };
    if(context.getStore())return observed();
    if(String(url).includes('/desktop/'))return transport(url,options);
    return withReplyTrace({},observed);
  };
}
