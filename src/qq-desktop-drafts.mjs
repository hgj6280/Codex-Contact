import { createHash } from 'node:crypto';

// Local previews only: this queue has no send transport and cannot publish to QQ.
export function createDesktopDrafts({validate,generate,maxActive=2,now=Date.now}) {
  const jobs=new Map();let active=0;
  const snapshot=job=>structuredClone(job);
  function prune(){
    for(const [id,job] of jobs)if(job.status!=='running'&&(now()-job.createdMs>3600000 || jobs.size>40))jobs.delete(id);
  }
  return {
    async start(input){
      if(!/^[a-f0-9-]{36}$/i.test(input.requestId || ''))throw new Error('AI 请求编号无效');
      const request=String(input.request||'').trim();
      if(!request || request.length>4000)throw new Error('请填写 1–4000 字的 AI 要求');
      const conversationId=String(input.conversationId||'');
      await validate(conversationId,input);
      if('localModel' in input && typeof input.localModel!=='boolean')throw new Error('本地模型参数无效');
      const payload={conversationId,request,replyMessageId:input.replyMessageId || null,...(input.localModel?{localModel:true}:{})};
      const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const old=jobs.get(input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('AI 请求编号已被使用');return snapshot(old);}
      prune();
      if(active>=maxActive)throw new Error('正在处理其他 AI 任务，请稍后再试');
      if([...jobs.values()].some(j=>j.conversationId===conversationId&&j.status==='running'))throw new Error('当前会话的 AI 草稿仍在生成');
      const job={id:input.requestId,...payload,fingerprint,status:'running',createdMs:now(),createdAt:new Date(now()).toISOString()};
      jobs.set(job.id,job);active++;
      Promise.resolve().then(()=>generate(payload)).then(result=>{job.status='completed';job.result=result;},error=>{
        job.status='failed';job.error=String(error.message||'AI 生成失败').slice(0,1500);
      }).finally(()=>{active--;job.completedAt=new Date(now()).toISOString();});
      return snapshot(job);
    },
    get(id){prune();const job=jobs.get(id);return job?snapshot(job):null;},
    active(){return active;}
  };
}
