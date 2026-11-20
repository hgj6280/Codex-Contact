export function createFastModeSettings({read,write}) {
  let queue=Promise.resolve();
  const snapshot=()=>({enabled:read()===true,revision:read()===true?'fast-1':'fast-0'});
  return {snapshot,update(body){
    const task=queue.then(async()=>{
      if(typeof body?.enabled!=='boolean')throw Object.assign(new Error('快速模式开关必须是布尔值'),{status:400});
      if(body.revision!==snapshot().revision)throw Object.assign(new Error('快速模式已在其他页面更改，请重新读取后再试'),{status:409});
      await write(body.enabled);return snapshot();
    });queue=task.catch(()=>{});return task;
  }};
}

export async function handleFastModeRequest(req,res,{store,isLocalRequest,readBody,sendJson}) {
  if(req.url!=='/api/qq/fast-mode')return false;
  if(!isLocalRequest(req)){sendJson(res,403,{error:'仅允许本机面板设置快速模式'});return true;}
  try{
    if(req.method==='GET')sendJson(res,200,store.snapshot());
    else if(req.method==='POST')sendJson(res,200,await store.update(await readBody(req,2048)));
    else sendJson(res,405,{error:'Unsupported method'});
  }catch(error){sendJson(res,error.status||500,{error:error.message});}
  return true;
}
