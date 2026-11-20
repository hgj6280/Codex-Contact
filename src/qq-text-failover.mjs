const networkCodes=['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'];
const transient=e=>e?.code!=='GEMINI_CONTENT_BLOCKED'&&([429,500,502,503,504].includes(e?.status)||e?.code==='GEMINI_INVALID_RESPONSE'||['TimeoutError','AbortError'].includes(e?.name)||networkCodes.includes(e?.code)||networkCodes.includes(e?.cause?.code));
export function createQqTextFailover({primary,fallback,now=Date.now,cooldownMs=180000}){
  let until=0,reason=null,epoch=0,probing=false;
  function noteUnavailable(e){if(!transient(e))return false;epoch++;until=now()+cooldownMs;reason=e.status?`Gemini HTTP ${e.status}`:e.code==='GEMINI_INVALID_RESPONSE'?'Gemini 返回空白或无效回复':e.name==='TimeoutError'||e.name==='AbortError'?'Gemini 连接超时':'Gemini 网络连接中断';return true;}
  const snapshot=()=>({primary:'gemini-3.8flash',activeModel:until?'gpt-6-luna':'gemini-3.8flash',degraded:Boolean(until),canTryPrimary:!until||now()>=until,retryAfter:until?new Date(until).toISOString():null,reason});
  const noteAvailable=()=>{epoch++;until=0;reason=null;};
  async function backup(prompt,started,options){const result=await fallback(prompt,options);return {...result,model:'gpt-6-luna',fallback:{from:'gemini-3.8flash',reason,retryAfter:new Date(until).toISOString()},durationMs:now()-started};}
  async function reply(prompt,options){
    const started=now();if(until>now()||probing)return backup(prompt,started,options);
    const revision=epoch,recovery=Boolean(until);if(recovery)probing=true;
    try{const result=await primary(prompt,options);if(revision===epoch){until=0;reason=null;}return result;}
    catch(e){if(!noteUnavailable(e))throw e;return backup(prompt,started,options);}
    finally{if(recovery)probing=false;}
  }
  return {reply,snapshot,noteUnavailable,noteAvailable};
}
