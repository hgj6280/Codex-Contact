const providers=['codex-cli','nano-banana-2'];
export function createImageModelSettings({read,write,gptModel}){
  let queue=Promise.resolve();
  const snapshot=()=>{
    const current=read(),provider=providers.includes(current.provider)?current.provider:'codex-cli',fallbackToGpt=current.fallbackToGpt===true;
    return {provider,fallbackToGpt,model:provider==='nano-banana-2'?'ag/gemini-3.1-flash-image':gptModel(),gptModel:gptModel(),fallbackModel:'gpt-6-luna',revision:`image-model:${provider}:${Number(fallbackToGpt)}`};
  };
  return {snapshot,update(body){
    const task=queue.then(async()=>{
      if(!providers.includes(body?.provider)||typeof body?.fallbackToGpt!=='boolean')throw Object.assign(new Error('请选择 GPT 或 Gemini，回退开关必须为布尔值'),{status:400});
      if(body.revision!==snapshot().revision)throw Object.assign(new Error('生图模型已在其他页面修改，请重新读取后再保存'),{status:409});
      await write({provider:body.provider,fallbackToGpt:body.fallbackToGpt});return snapshot();
    });queue=task.catch(()=>{});return task;
  }};
}
export async function handleImageModelRequest(req,res,{store,isLocalRequest,readBody,sendJson}){
  if(req.url!=='/api/qq/image-model')return false;
  if(!isLocalRequest(req)){sendJson(res,403,{error:'只允许本机修改生图模型'});return true;}
  try{
    if(req.method==='GET')sendJson(res,200,store.snapshot());
    else if(req.method==='POST')sendJson(res,200,await store.update(await readBody(req,2048)));
    else sendJson(res,405,{error:'Unsupported method'});
  }catch(error){sendJson(res,error.status||500,{error:error.message});}
  return true;
}
