import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {saveJsonAtomic} from './atomic-json.mjs';

export function isQqNewSessionCommand(text){return /^\/new$/i.test(String(text||'').replace(/\[CQ:at,[^\]]+\]/g,'').trim());}
function conversationKey(event){
  const key=event.desktopConversationId||(event.groupId?String(event.groupId):`private:${event.senderId}`);
  if(!/^(?:private:)?\d{5,13}$/.test(key))throw new Error('会话编号无效');
  return key;
}
// A boundary, not a deletion. Keep the original QQ history and all material.
export function filterQqSessionEntries(entries,session){
  if(!session?.after)return entries;
  const boundary=Date.parse(session.after);
  return entries.filter(row=>Date.parse(row.at||row.timestamp||'')>=boundary&&(!row.aiSessionId||row.aiSessionId===session.id));
}
export async function openQqAiSessions(path,{now=()=>new Date().toISOString(),uuid=randomUUID,save=saveJsonAtomic}={}){
  let sessions=await readFile(path,'utf8').then(JSON.parse).then(v=>v.sessions||{}).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
  let tail=Promise.resolve();
  const snapshot=event=>structuredClone(sessions[conversationKey(event)]||{id:'default',after:null});
  return {snapshot,reset(event){
    const key=conversationKey(event);
    const job=tail.then(async()=>{
      const session={id:uuid(),after:now()};
      const next={...sessions,[key]:session};
      await save(path,{version:1,sessions:next});sessions=next;return structuredClone(session);
    });tail=job.catch(()=>{});return job;
  }};
}
