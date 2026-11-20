import {createHash} from 'node:crypto';

const validId=id=>typeof id==='string' && /^(?:private:)?\d{5,13}$/.test(id);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function normalizeDisabledConversations(input=[]){
  if(!Array.isArray(input)||input.length>5000||input.some(id=>!validId(id)))throw fail('会话 AI 开关格式不正确');
  return [...new Set(input)].sort();
}
export function isQqConversationAiEnabled(event,disabled=[]){
  const id=event.type==='private_message'?`private:${event.senderId}`:String(event.groupId);
  return !disabled.includes(id);
}
export function createConversationAiSettings({read,write,validateConversation}){
  let tail=Promise.resolve();
  function snapshot(){
    const disabledConversations=normalizeDisabledConversations(read());
    return {disabledConversations,revision:createHash('sha256').update(JSON.stringify(disabledConversations)).digest('hex')};
  }
  return {snapshot,update(input){
    const candidate=structuredClone(input);
    const job=tail.then(async()=>{
      const ids= candidate?.conversationIds??[candidate?.conversationId];
      if(!Array.isArray(ids)||!ids.length||ids.length>5000||ids.some(id=>!validId(id))||typeof candidate.enabled!=='boolean')throw fail('请指定有效的群聊或私聊及开关状态');
      for(const id of new Set(ids))await validateConversation(id);
      const current=snapshot();
      if(candidate.revision!==current.revision)throw fail('会话开关已在其他页面更新，请重新读取后再试',409);
      const disabled=new Set(current.disabledConversations);
      for(const id of new Set(ids)){if(candidate.enabled)disabled.delete(id);else disabled.add(id); }
      const next=normalizeDisabledConversations([...disabled]);
      if(JSON.stringify(next)!==JSON.stringify(current.disabledConversations))await write(next);
      return snapshot();
    });tail=job.catch(()=>{});return job;
  }};
}
export async function handleConversationAiRequest(req,res,{store,isLocalRequest,readBody,sendJson}){
  if(req.url!=='/api/qq/conversation-ai')return false;
  if(!isLocalRequest(req)||req.headers['sec-fetch-site']==='cross-site'){sendJson(res,403,{error:'只允许本机管理页面修改会话开关'});return true;}
  try{
    if(req.method==='GET')sendJson(res,200,store.snapshot());
    else if(req.method==='POST')sendJson(res,200,await store.update(await readBody(req,131072)));
    else sendJson(res,405,{error:'不支持此操作'});
  }catch(e){sendJson(res,e.status||400,{error:e.message});}
  return true;
}
