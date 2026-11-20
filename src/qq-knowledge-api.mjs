export async function handleKnowledgeApi(req,res,{store,isLocalRequest,bind,readBody,sendJson}){
  const url=new URL(req.url,'http://127.0.0.1');if(url.pathname!=='/api/qq/knowledge')return false;
  if(!isLocalRequest(req)||req.headers['sec-fetch-site']==='cross-site'){sendJson(res,403,{error:'仅允许本机管理资料'});return true;}
  if(!store){sendJson(res,503,{error:'资料库暂不可用，普通聊天不受影响'});return true;}
  try{
    if(!['GET','POST'].includes(req.method)){sendJson(res,405,{error:'请求方式不支持'});return true;}
    const body=req.method==='POST'?await readBody(req,900000):{};
    const event=await bind(String(body.conversationId||url.searchParams.get('conversationId')||''));
    if(req.method==='GET')sendJson(res,200,url.searchParams.get('id')?{document:store.read(event,url.searchParams.get('id'))}:store.list(event,{query:url.searchParams.get('query')||'',offset:Number(url.searchParams.get('offset')||0)}));
    else if(body.action==='save')sendJson(res,200,{document:store.save(event,body.document)});
    else if(body.action==='delete')sendJson(res,200,store.remove(event,body.id,body.revision));
    else if(body.action==='settings')sendJson(res,200,{settings:store.updateSettings(event,body.settings)});
    else throw Error('资料操作不存在');
  }catch(e){sendJson(res,e.status||400,{error:e.message});}return true;
}
