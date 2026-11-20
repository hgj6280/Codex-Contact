import {createHash} from 'node:crypto';

export const DEFAULT_QQ_TRIGGERS = Object.freeze({enabled:true, words:Object.freeze(['狐宫静'])});
const fail = (message, status=400) => Object.assign(new Error(message), {status});
export function normalizeQqTriggers(input=DEFAULT_QQ_TRIGGERS) {
  if (!input || typeof input.enabled !== 'boolean' ||
      !(typeof input.words === 'string' || Array.isArray(input.words))) throw fail('触发词设置格式不正确');
  const parts = typeof input.words === 'string' ? input.words.split(/[\n\r,，;；]+/u) : input.words;
  if (parts.length > 200) throw fail('触发词过多，最多 20 个');
  const words=[],seen=new Set();
  for (const part of parts) {
    if (typeof part !== 'string' || !part.isWellFormed() || /[\p{Cc}\p{Cf}]/u.test(part)) throw fail('触发词不能包含控制字符');
    const word=part.normalize('NFKC').trim();
    if (!word) continue;
    if (Array.from(word).length > 40 || /[\n\r,，;；]|\[CQ:/iu.test(word)) throw fail('每个触发词最多 40 字，不能包含分隔符或 CQ 消息代码');
    const key=word.toLowerCase();
    if (!seen.has(key)) {seen.add(key);words.push(word);}
  }
  if (words.length>20) throw fail('最多设置 20 个触发词');
  if (input.enabled && !words.length) throw fail('启用关键词触发前，请至少填写一个词');
  return {enabled:input.enabled,words};
}
export function matchQqTrigger(text, config=DEFAULT_QQ_TRIGGERS) {
  if (!config.enabled) return null;
  // Only visible text counts, never a filename/URL or someone else's CQ @ name.
  const visible=String(text || '').replace(/\[CQ:[^\]]*\]/gi,'').normalize('NFKC').toLowerCase();
  return config.words.find(word=>visible.includes(word.toLowerCase())) || null;
}
export function createQqTriggerSettings({read,write}) {
  let tail=Promise.resolve();
  function snapshot(){
    const config=normalizeQqTriggers(read());
    return {...config,revision:createHash('sha256').update(JSON.stringify(config)).digest('hex'),maxWords:20,maxWordLength:40};
  }
  return {snapshot,update(input){
    const candidate=structuredClone(input);
    const job=tail.then(async()=>{
      const config=normalizeQqTriggers(candidate),old=snapshot();
      if (candidate.revision!==old.revision) throw fail('设置已在其他页面更新，请重新读取后再保存',409);
      if (JSON.stringify(config)!==JSON.stringify({enabled:old.enabled,words:old.words})) await write(config);
      return snapshot();
    });
    tail=job.catch(()=>{});return job;
  }};
}
export async function handleQqTriggerRequest(req,res,{store,isLocalRequest,readBody,sendJson}) {
  if (req.url!=='/api/qq/triggers') return false;
  if (!isLocalRequest(req) || req.headers['sec-fetch-site']==='cross-site') {
    sendJson(res,403,{error:'只允许本机管理页面修改触发词'});return true;
  }
  try {
    if (req.method==='GET') sendJson(res,200,store.snapshot());
    else if (req.method==='POST') sendJson(res,200,await store.update(await readBody(req,16384)));
    else sendJson(res,405,{error:'不支持此操作'});
  } catch(e){sendJson(res,e.status||500,{error:e.status?e.message:'保存失败，原触发词未改变，请检查后台存储'});}
  return true;
}
