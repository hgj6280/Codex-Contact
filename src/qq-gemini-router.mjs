import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

// Resolve the existing local route without copying credentials into source or UI.
export function createGeminiRouterReply({fetchImpl=fetch, readConfig=async()=>JSON.parse(await readFile(join(homedir(),'.openclaw','openclaw.json'),'utf8')), timeoutMs=90000,maxTokens=2048,analysis=false}={}) {
  return async (prompt,{signal,maxTokens:requestedTokens}={}) => {
    if (!String(prompt||'').trim()) throw new Error('Gemini 请求不能为空');
    const config=await readConfig();
    const provider=config.models?.providers?.antigravity9router ?? config.models?.providers?.['腾讯肥鱼'];
    if(provider?.baseUrl!=='http://127.0.0.1:20128/v1' || !provider.apiKey) throw new Error('本机 Gemini 9router 配置不可用');
    const started=Date.now();
    const response=await fetchImpl(provider.baseUrl+'/chat/completions',{
      method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),
      headers:{'content-type':'application/json',authorization:'Bearer '+provider.apiKey},
      body:JSON.stringify({model:'ag/gemini-3.8-flash',stream:false,max_tokens:Number.isInteger(requestedTokens)?Math.max(256,Math.min(6144,requestedTokens)):maxTokens,
        messages:[{role:'user',content:String(prompt).toWellFormed()+(analysis?'\n只输出所要求的 JSON，不执行工具。':'\n仅回复 QQ 文字，不生图、不执行工具。')}]})
    });
    if(!response.ok){await response.body?.cancel();throw Object.assign(new Error(`Gemini 9router 请求失败（HTTP ${response.status}）`),{status:response.status,code:'GEMINI_HTTP_ERROR'});}
    const body=await response.json();
    const text=body.choices?.[0]?.message?.content;
    if(body.error || typeof text!=='string' || !text.trim() || text.length>100000) {
      // A successful HTTP response can still contain no usable assistant text.
      // Keep deliberate model refusals/blocking separate from transient transport
      // or empty-response failures; only the latter should use the backup route.
      const blocked=body.promptFeedback?.blockReason || body.choices?.some(choice=>choice.finish_reason==='content_filter');
      const status=Number(body.error?.status ?? body.error?.code);
      throw Object.assign(new Error('Gemini 9router 未返回有效文字'),{
        code:blocked?'GEMINI_CONTENT_BLOCKED':body.error?'GEMINI_UPSTREAM_ERROR':'GEMINI_INVALID_RESPONSE',
        ...(status>=400&&status<=599?{status}:{})
      });
    }
    return {text:text.trim(),model:'gemini-3.8flash',durationMs:Date.now()-started,promptChars:String(prompt).length,
      conversationReused:false,usage:{...body.usage,available:Boolean(body.usage)}};
  };
}
