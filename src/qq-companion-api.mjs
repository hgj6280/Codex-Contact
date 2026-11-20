export async function handleCompanionRequest(req,res,{store,isLocalRequest,assertAccess,readBody,sendJson}){
  const url=new URL(req.url,'http://127.0.0.1');
  if(!['/api/qq/companion/settings','/api/qq/companion/memories','/api/qq/companion/archive'].includes(url.pathname))return false;
  if(!isLocalRequest(req)||req.headers['sec-fetch-site']==='cross-site'){
    sendJson(res,403,{error:'仅允许本机管理面板访问记忆'});return true;
  }
  if(!store){sendJson(res,503,{error:'长期记忆暂不可用，普通聊天和生图不受影响'});return true;}
  try{
    if(url.pathname.endsWith('/settings')){
      if(req.method==='GET')sendJson(res,200,store.snapshot());
      else if(req.method==='POST')sendJson(res,200,store.update(await readBody(req,2048)));
      else sendJson(res,405,{error:'Unsupported method'});
    }else{
      const body=req.method==='POST'?await readBody(req,2048):{};
      const conversationId=String(body.conversationId||url.searchParams.get('conversationId')||'');
      const userId=String(body.userId||url.searchParams.get('userId')||'');
      if(!/^(?:private:)?\d{5,13}$/.test(conversationId)||!/^\d{5,13}$/.test(userId))throw Error('请选择会话并填写 QQ 号');
      await assertAccess(conversationId);
      const privateChat=conversationId.startsWith('private:');
      if(privateChat&&conversationId!==`private:${userId}`)throw Error('私聊记忆归属不匹配');
      const event={type:privateChat?'private_message':'group_message',senderId:userId,groupId:privateChat?null:conversationId};
      if(url.pathname.endsWith('/archive')){
        if(req.method!=='GET')throw Error('完整存档仅提供按需读取');
        sendJson(res,200,store.archiveList(event,{query:String(url.searchParams.get('query')||'').slice(0,240),offset:Number(url.searchParams.get('offset'))||0}));return true;
      }
      if(req.method==='GET')sendJson(res,200,{memories:store.list(event),emotion:store.emotionState(event),diary:store.diaries?.(event)||[],purposes:store.purposes?.(event)||[],groupTopics:store.groupMemories?.(event,{query:String(url.searchParams.get('query')||'').slice(0,240)})||[]});
      else if(req.method==='POST'){
        if(!['forget','update','pin'].includes(body.action)||typeof body.id!=='string'||!(body.action==='forget'&&body.id==='all'||/^[a-f0-9-]{36}$/i.test(body.id)))throw Error('记忆操作参数无效');
        sendJson(res,200,body.action==='pin'?{memory:store.pin(event,body.id,body.pinned)}:body.action==='update'?{memory:store.revise(event,body.id,body.content)}:{removed:store.forget(event,body.id)});
      }else sendJson(res,405,{error:'Unsupported method'});
    }
  }catch(e){sendJson(res,e.status||400,{error:e.message});}
  return true;
}
