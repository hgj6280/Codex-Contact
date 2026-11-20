import {readFile} from 'node:fs/promises';
import {saveJsonAtomic} from './atomic-json.mjs';
const valid=x=>/^\d{5,13}$/.test(String(x||''));
export async function openQqGroupMuteGuard(path,{lookup,now=Date.now,ttlMs=60000}){
  let saved={};try{saved=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const groups=new Map(Object.entries(saved).filter(([id,r])=>valid(id)&&valid(r.selfId)&&Number.isFinite(r.until)&&r.until>now()&&r.until<8.64e15)),pending=new Map();
  const persist=()=>saveJsonAtomic(path,Object.fromEntries(groups));
  const blocked=e=>{const row=groups.get(String(e.groupId));return Boolean(row&&row.selfId===String(e.selfId)&&row.until>now());};
  async function refresh(groupId,selfId,{force=false}={}){
    const id=String(groupId||''),user=String(selfId||'');if(!valid(id)||!valid(user))return null;
    const old=groups.get(id);if(!force&&!old)return null;
    if(old&&(old.selfId!==user||old.until<=now())){groups.delete(id);await persist();if(!force)return null;}
    else if(!force&&old&&now()-old.checkedAt<ttlMs)return old;
    if(pending.has(id))return pending.get(id);
    const work=(async()=>{
      try{
        const member=await lookup(id,user);
        if(String(member.user_id)!==user||String(member.group_id)!==id)throw Error('Cannot verify bot group membership');
        const until=Number(member.shut_up_timestamp)*1000;
        if(Number.isFinite(until)&&until>now()&&until<8.64e15)groups.set(id,{selfId:user,until,checkedAt:now()});else groups.delete(id);
        await persist();return groups.get(id)||null;
      }catch{if(old&&old.selfId===user&&old.until>now()){groups.set(id,{...old,checkedAt:now()});return groups.get(id);}return null;}
    })();pending.set(id,work);try{return await work;}finally{pending.delete(id);}
  }
  return {blocked,refresh,snapshot:()=>[...groups].filter(([,r])=>r.until>now()).map(([groupId,r])=>({groupId,selfId:r.selfId,until:new Date(r.until).toISOString()}))};
}
