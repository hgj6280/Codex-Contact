export class DesktopRequestError extends Error {
  constructor(message,code,status){super(message);this.name='DesktopRequestError';this.code=code;this.status=status;}
}

// Reserve browser connections for commands: three JSON reads and two chat images.
export function createDesktopTransport({fetchImpl=fetch,readLimit=3,readTimeout=15000,writeTimeout=30000,onEvent=()=>{}}={}){
  const pending=new Map(),queue=[];let active=0;
  const emit=event=>{try{onEvent(event);}catch{}};
  function pump(){queue.sort((a,b)=>a.priority-b.priority);while(active<readLimit&&queue.length){const task=queue.shift();active++;task.run().then(task.resolve,task.reject).finally(()=>{active--;pump();});}}
  function schedule(run,priority){return new Promise((resolve,reject)=>{queue.push({run,priority,resolve,reject});pump();});}
  async function attempt(path,body,tag){
    const controller=new AbortController(),started=Date.now();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},body===undefined?readTimeout:writeTimeout);
    try{
      const response=await fetchImpl(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(tag?{'if-none-match':tag}:{})},
        cache:'no-store',...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
      if(response.status===304)return null;
      let value;try{value=await response.json();}catch(error){if(controller.signal.aborted||error.name==='AbortError')throw error;throw new DesktopRequestError('后台响应不完整，请稍后重试','INVALID_JSON');}
      if(!response.ok)throw new DesktopRequestError(value.error||`服务返回 ${response.status}`,'HTTP',response.status);
      emit({path,method:body===undefined?'GET':'POST',ms:Date.now()-started,status:response.status});
      return {tag:response.headers.get('etag')||'',data:value};
    }catch(error){
      const failure=error instanceof DesktopRequestError?error:new DesktopRequestError(
        body===undefined?'读取暂时中断，正在重试': '发送请求中断，结果未确认；请先检查 QQ，避免重复发送',
        timedOut?'TIMEOUT':error.name==='AbortError'?'ABORT':'NETWORK');
      emit({path,method:body===undefined?'GET':'POST',ms:Date.now()-started,error:failure.code,status:failure.status});throw failure;
    }finally{clearTimeout(timer);}
  }
  function get(path,tag=''){
    const key=JSON.stringify([path,tag]);if(pending.has(key))return pending.get(key);
    const work=schedule(async()=>{try{return await attempt(path,undefined,tag);}catch(error){if(!['TIMEOUT','ABORT','NETWORK'].includes(error.code))throw error;return attempt(path,undefined,tag);}},path.endsWith('/desktop-state')?0:1);
    pending.set(key,work);work.then(()=>pending.delete(key),()=>pending.delete(key));return work;
  }
  return {cached:get,async api(path,body){return (body===undefined?await get(path):await attempt(path,body))?.data;}};
}

export function createChatImageLoader({root,limit=2,timeout=45000,Observer=globalThis.IntersectionObserver}={}){
  const queue=[],entries=new Map();let active=0;
  const observer=Observer?new Observer(list=>{for(const item of list)if(item.isIntersecting){observer.unobserve(item.target);enqueue(item.target);}}, {root,rootMargin:'160px'}):null;
  function pump(){while(active<limit&&queue.length){const img=queue.shift(),entry=entries.get(img);if(!entry||entry.active||!img.isConnected)continue;
      entry.active=true;active++;entry.done=()=>{if(!entry.active)return;entry.active=false;active--;clearTimeout(entry.timer);img.onload=img.onerror=null;entries.delete(img);pump();};
      img.onload=()=>{entry.done();entry.onLoad();};img.onerror=()=>{entry.done();entry.onError();};
      entry.timer=setTimeout(()=>{img.removeAttribute('src');entry.done();entry.onError();},timeout);
      img.src=entry.url;
    }}
  function enqueue(img){const e=entries.get(img);if(!e||e.queued)return;e.queued=true;queue.push(img);pump();}
  function remove(img){const e=entries.get(img);if(!e)return;observer?.unobserve(img);if(e.active){img.removeAttribute('src');e.done();}else entries.delete(img);}
  return {
    add(img,url,onLoad=()=>{},onError=()=>{}){remove(img);entries.set(img,{url,onLoad,onError,queued:false,active:false});if(observer)observer.observe(img);else enqueue(img);},
    retry(img,url,onLoad,onError){this.add(img,url,onLoad,onError);observer?.unobserve(img);enqueue(img);},
    prune(){for(const img of entries.keys())if(!img.isConnected)remove(img);pump();}
  };
}
