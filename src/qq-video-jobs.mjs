import {taskOrigin,withTaskTrace} from './qq-observability.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,chmod,readdir,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {parseVideoCommand,videoError} from './qq-video-input.mjs';
import {summarizeVideo,answerVideo,cleanVideoReply,videoTime,transcriptChunks} from './qq-video-summary.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const videoDefaults={enabled:true,autoGroups:[],concurrency:1,maxQueue:8,maxDurationSeconds:1800,maxDownloadMB:96,taskTimeoutSeconds:900,perUserDaily:5,perGroupDaily:20,cacheHours:24,tempRetentionHours:6,transcriptRetentionDays:30,useDedicatedCookies:{bilibili:false,douyin:false,youtube:false}};
const scopeOf=e=>e.type==='private_message'?`private:${e.senderId}`:`group:${e.groupId}`;
const statuses={queued:'排队中',resolving:'获取视频信息',subtitles:'读取字幕',downloading:'提取音频',transcribing:'语音转写',summarizing:'总结中',completed:'总结完成',failed:'失败',cancelled:'已取消'};
export async function openVideoJobs(directory,{worker,model,getModelKey=()=>'',getStyle=()=>'',send,canSend=async()=>true,isImageRequest=()=>false,stripMentions=text=>text,isController=()=>false,now=Date.now}={}){
  await mkdir(directory,{recursive:true,mode:0o700});const db=new DatabaseSync(join(directory,'jobs.sqlite'));await chmod(join(directory,'jobs.sqlite'),0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA cache_size=-512;
    CREATE TABLE IF NOT EXISTS video_settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS video_jobs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,sender TEXT NOT NULL,eventKey TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL,delivery TEXT NOT NULL,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS video_job_scope ON video_jobs(scope,created);
    CREATE TABLE IF NOT EXISTS video_content(key TEXT PRIMARY KEY,scope TEXT NOT NULL,expires INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS video_context(scope TEXT PRIMARY KEY,jobId TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS video_messages(scope TEXT NOT NULL,messageId TEXT NOT NULL,jobId TEXT NOT NULL,PRIMARY KEY(scope,messageId));`);
  let config={...videoDefaults,...JSON.parse(db.prepare('SELECT data FROM video_settings WHERE id=1').get()?.data||'{}')},closed=false,pumpPending=false;
  const active=new Map();
  const decode=row=>row?JSON.parse(row.data):null;
  const get=id=>decode(db.prepare('SELECT data FROM video_jobs WHERE id=?').get(id));
  const rows=(scope,selfId)=>db.prepare("SELECT data FROM video_jobs WHERE scope=? AND json_extract(data,'$.selfId')=? ORDER BY created DESC LIMIT 100").all(scope,String(selfId)).map(decode);
  const persist=j=>{j.updatedAt=now();db.prepare('INSERT INTO video_jobs VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,delivery=excluded.delivery,data=excluded.data').run(j.id,j.scope,j.sender,j.eventKey,j.createdAt,j.status,j.delivery.status,JSON.stringify(j));};
  function expireUnconfirmed(){for(const row of db.prepare("SELECT data FROM video_jobs WHERE status='queued' AND created<? AND json_extract(data,'$.acknowledged')=0").all(now()-300000)){const j=decode(row);j.status='failed';j.delivery.status='failed';j.error={code:'ACK_UNCONFIRMED',message:'接收确认未得到 QQ 通道确认，任务没有运行，可重试'};persist(j);}}
  const eventFor=j=>({type:j.scope.startsWith('private:')?'private_message':'group_message',groupId:j.scope.startsWith('group:')?j.scope.slice(6):null,senderId:j.sender,selfId:j.selfId,raw:{message_id:j.sourceId},text:j.originalRequest,videoTask:j.id,videoTool:true});
  const view=j=>j&&({id:j.id,platform:j.source.platform,videoId:j.content?.metadata?.id||j.metadata?.id||j.source.id,p:j.source.p,groupId:j.scope.startsWith('group:')?j.scope.slice(6):null,senderId:j.sender,sourceMessageId:j.sourceId,status:j.status,stage:statuses[j.status],createdAt:j.createdAt,title:j.content?.metadata?.title||j.metadata?.title,result:j.summary?.text||null,error:j.error||null,delivery:j.delivery,cached:j.cached===true,attempts:j.attempts,transcriptExpired:j.transcriptExpired===true});
  function setting(input){
    const next={...config};if(input.revision!==config.revision&&config.revision)throw Error('视频设置已更新，请重新读取');
    for(const key of ['enabled'])if(key in input){if(typeof input[key]!=='boolean')throw Error('视频开关无效');next[key]=input[key];}
    if('autoGroups' in input){if(!Array.isArray(input.autoGroups)||input.autoGroups.length>200||input.autoGroups.some(x=>!/^\d{5,13}$/.test(String(x))))throw Error('自动总结群号无效');next.autoGroups=[...new Set(input.autoGroups.map(String))];}
    for(const [key,min,max] of [['concurrency',1,2],['maxQueue',1,30],['maxDurationSeconds',30,7200],['maxDownloadMB',8,256],['taskTimeoutSeconds',60,1800],['perUserDaily',1,100],['perGroupDaily',1,500],['cacheHours',1,168],['tempRetentionHours',1,24],['transcriptRetentionDays',1,365]])if(key in input){if(!Number.isInteger(input[key])||input[key]<min||input[key]>max)throw Error('视频限制参数无效：'+key);next[key]=input[key];}
    if('useDedicatedCookies' in input){for(const platform of ['bilibili','douyin','youtube'])if(typeof input.useDedicatedCookies?.[platform]!=='boolean')throw Error('专用 Cookie 开关无效');next.useDedicatedCookies={...input.useDedicatedCookies};}
    next.revision=randomUUID();db.prepare('INSERT OR REPLACE INTO video_settings VALUES(1,?)').run(JSON.stringify(next));config=next;kick();return snapshot();
  }
  function snapshot(){return {...config,active:active.size,queued:db.prepare("SELECT count(*) AS n FROM video_jobs WHERE status='queued'").get().n};}
  function find(event,id){const scope=scopeOf(event),self=String(event.selfId);if(!id)return decode(db.prepare("SELECT data FROM video_jobs WHERE scope=? AND json_extract(data,'$.selfId')=? ORDER BY created DESC LIMIT 1").get(scope,self));if(!/^[a-f0-9-]{8,36}$/i.test(String(id)))throw Error('任务编号无效');const found=db.prepare("SELECT data FROM video_jobs WHERE scope=? AND json_extract(data,'$.selfId')=? AND id LIKE ? LIMIT 2").all(scope,self,String(id)+'%').map(decode);if(found.length>1)throw Error('任务编号不明确，请使用完整编号');return found[0]||null;}
  function contextJobs(event){return rows(scopeOf(event),event.selfId).filter(j=>j.status==='completed'&&j.content&&now()-j.createdAt<2*3600000);}
  function quotedJobRow(event){return event.replyContext?.messageId?db.prepare("SELECT j.data FROM video_messages m JOIN video_jobs j ON j.id=m.jobId WHERE m.scope=? AND m.messageId=? AND json_extract(j.data,'$.selfId')=?").get(scopeOf(event),String(event.replyContext.messageId),String(event.selfId)):null;}
  function rememberAnswer(event,id,delivery){const messageId=delivery?.messageId||delivery?.body?.data?.message_id;if(messageId)db.prepare('INSERT OR REPLACE INTO video_messages VALUES(?,?,?)').run(scopeOf(event),String(messageId),id);}
  function detect(event){if(!config.enabled)return null;const scope=scopeOf(event),quotedVideo=Boolean(quotedJobRow(event));const action=parseVideoCommand(event,{auto:config.autoGroups.includes(String(event.groupId)),hasContext:quotedVideo||Boolean(db.prepare("SELECT c.jobId FROM video_context c JOIN video_jobs j ON j.id=c.jobId WHERE c.scope=? AND c.at>? AND json_extract(j.data,'$.selfId')=?").get(scope,now()-2*3600000,String(event.selfId))),quotedVideo,stripMentions});return action?.action==='followup'&&isImageRequest(event)?null:action;}
  function cacheKey(event,source){return hash([String(event.selfId),scopeOf(event),source.platform,source.id,source.p,config.useDedicatedCookies[source.platform]?'dedicated':'public']);}
  function kick(){if(closed||pumpPending)return;pumpPending=true;setTimeout(()=>{pumpPending=false;pump().catch(()=>{});},100).unref?.();}
  function acknowledge(id,ok=true){const j=get(id);if(!j)return;j.acknowledged=ok;persist(j);if(ok)kick();}
  async function submit(event,source,style,{retryOf}={}){
    expireUnconfirmed();
    const scope=scopeOf(event),sourceId=String(event.raw?.message_id||event.messageId||'');
    if(!/^(?:group|private):\d{5,13}$/.test(scope)||!/^\d{5,13}$/.test(String(event.senderId))||!sourceId)throw Error('视频任务缺少适配器绑定的真实会话身份');
    if(String(event.selfId)===String(event.senderId))return {reply:null,duplicate:true};
    const eventKey=hash([event.selfId,scope,sourceId]);const existing=decode(db.prepare('SELECT data FROM video_jobs WHERE eventKey=?').get(eventKey));if(existing)return {reply:null,duplicate:true,task:view(existing)};
    const key=cacheKey(event,source),summaryKey=hash([key,style,getModelKey()]);
    const same=rows(scope,event.selfId).find(j=>j.summaryKey===summaryKey&&!['failed','cancelled','completed'].includes(j.status));if(same)return {reply:`本群已有同一视频的任务 ${same.id.slice(0,8)} 在处理，完成后会在这里回复。`,task:view(same)};
    const day=new Date(now()).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),start=Date.parse(day+'T00:00:00+08:00');
    if(db.prepare('SELECT count(*) AS n FROM video_jobs WHERE scope=? AND created>=?').get(scope,start).n>=config.perGroupDaily||db.prepare('SELECT count(*) AS n FROM video_jobs WHERE sender=? AND created>=?').get(String(event.senderId),start).n>=config.perUserDaily)throw Error('今天的视频任务额度已用完，明天再试或让管理员调整额度');
    if(snapshot().queued>=config.maxQueue)throw Error('视频队列已满，普通聊天仍可继续，请稍后再试');
    const cached=rows(scope,event.selfId).find(j=>j.summaryKey===summaryKey&&j.status==='completed'&&j.content&&now()-j.createdAt<config.cacheHours*3600000);
    const j={id:randomUUID(),timing:taskOrigin(),scope,sender:String(event.senderId),selfId:String(event.selfId),sourceId,eventKey,source,originalRequest:String(event.text||''),style,status:'queued',createdAt:now(),delivery:{status:'pending',parts:[]},acknowledged:false,key,summaryKey,attempts:0,retryOf,limits:structuredClone(config),...(cached?{content:cached.content,summary:cached.summary,cached:true}:{})};persist(j);
    return {reply:`收到啦，视频任务 ${j.id.slice(0,8)} 已${cached?'命中本群缓存，准备回复':'进入队列，完成后在这里发总结'}。期间可以继续聊天；用 /视频 状态 ${j.id.slice(0,8)} 查询。`,task:view(j),afterSend:()=>acknowledge(j.id)};
  }
  async function handle(event){
    const command=detect(event);if(!command)return null;
    if(command.action==='missing')return {reply:'我没在这条消息或实际引用内容里取得可用视频链接。请补发 B站 BV号、抖音分享链接或 YouTube 链接。',video:true};
    if(command.action==='submit'){if(command.sources.length!==1)return {reply:'这条消息有多个视频，请指定这次要总结哪一个；默认不会处理整个合集。',video:true};return {...await submit(event,command.sources[0],command.style),video:true};}
    if(['auto-on','auto-off'].includes(command.action)){
      if(!isController(event))return {reply:'按群自动总结开关请让管理员或本机控制者设置。',video:true};if(!event.groupId)return {reply:'自动总结是群聊开关，请在目标群里使用。',video:true};
      setting({revision:config.revision,autoGroups:command.action==='auto-on'?[...config.autoGroups,String(event.groupId)]:config.autoGroups.filter(id=>id!==String(event.groupId))});return {reply:command.action==='auto-on'?'本群已开启收到公开视频链接自动总结。':'本群已关闭自动总结，明确要求总结仍可使用。',video:true};
    }
    if(command.action==='followup'){
      const cited=decode(quotedJobRow(event));if(cited&&!cited.content)return {reply:'这个视频的真实正文已到期清理，请重新提交视频后继续问。',video:true};let candidates=cited?[cited]:contextJobs(event);
      if(!cited&&command.sources.length)candidates=candidates.filter(j=>command.sources.some(s=>s.platform===j.source.platform&&s.id===j.source.id&&s.p===j.source.p));
      const distinct=[...new Map(candidates.map(j=>[j.key,j])).values()];if(distinct.length!==1)return {reply:distinct.length?'你指哪个视频呀？引用对应总结，或附上它的链接，我再接着讲。':'本会话暂时没有这个视频的真实正文，请先总结视频。',video:true};
      const j=distinct[0];const reply=await answerVideo(j.content,j.summary,command.question,{model,getStyle,signal:AbortSignal.timeout(90000)});return {reply,video:true,afterSend:delivery=>rememberAnswer(event,j.id,delivery)};
    }
    const j=find(event,command.id);if(!j)return {reply:'本会话没有找到这个视频任务。',video:true};
    if(command.action==='status')return {reply:`${j.id.slice(0,8)}：${statuses[j.status]}；群回复：${j.delivery.status}${j.error?'。原因：'+j.error.message:''}`,video:true};
    if(command.action==='read')return {reply:j.summary?formatResult(j):j.error?.message||'视频正文还在处理中，暂时没有结果。',video:true};
    if(command.action==='transcript')return {reply:j.content?transcriptChunks(j.content.segments,1000)[0]+'\n（这是转录前段；完整带时间点正文已保存，可按具体时间继续问。）':'尚未取得真实正文。',video:true};
    if(['cancel','retry'].includes(command.action)&&j.sender!==String(event.senderId))return {reply:'只能取消或重试自己提交的视频任务。',video:true};
    if(command.action==='cancel'){if(['completed','failed','cancelled'].includes(j.status))return {reply:'这个任务已结束，不会重新发送。',video:true};j.status='cancelled';j.delivery.status='cancelled';persist(j);active.get(j.id)?.abort();return {reply:'视频任务已取消。',video:true};}
    if(command.action==='retry'){if(j.status!=='failed')return {reply:'只能重试失败的视频任务；结果未知的发送不会自动重复。',video:true};return {...await submit(event,j.source,j.style,{retryOf:j.id}),video:true};}
    return null;
  }
  function formatResult(j){const m=j.content?.metadata||j.metadata||{title:j.source.id,url:j.source.url,platform:j.source.platform};return `${m.title}${m.platform==='bilibili'?` · 第${j.source.p}P${m.partCount>1?`/共${m.partCount}P`:''}`:''}\n\n${j.summary.text}\n\n来源：${m.url}\n${j.content?`本次仅基于${j.content.mode==='asr'?'完整音频转写':'字幕'}，未分析画面、未做外部事实核查${j.content.mode==='asr'?'；转写可能有误':''}。`:'这是历史摘要；对应正文已到期清理，无法继续逐段追问，未做画面分析或外部核查。'}\n任务 ${j.id.slice(0,8)}`;}
  async function deliver(j){
    if(!await canSend(eventFor(j))){j.delivery.status='blocked';persist(j);return;}
    const reply=j.status==='failed'?`视频任务 ${j.id.slice(0,8)} 没有完成：${j.error.message}。未凭标题生成总结；可用 /视频 重试 ${j.id.slice(0,8)}。`:formatResult(j);
    const parts=cleanVideoReply(reply).match(/[\s\S]{1,1350}/gu)||[];j.delivery.status='sending';persist(j);
    for(const part of parts){
      if(!await canSend(eventFor(j))){j.delivery.status='blocked';persist(j);return;}
      try{const requestId=randomUUID();j.delivery.pendingRequestId=requestId;persist(j);const result=await send(eventFor(j),part,{requestId});if(!result?.ok){j.delivery.status=result?.unknown?'unknown':'failed';j.delivery.error=result?.reason||'QQ 未确认接收';persist(j);return;}j.delivery.parts.push({messageId:String(result.messageId||''),verified:result.verified===true,at:now()});if(result.messageId&&j.status==='completed')db.prepare('INSERT OR REPLACE INTO video_messages VALUES(?,?,?)').run(j.scope,String(result.messageId),j.id);delete j.delivery.pendingRequestId;persist(j);}
      catch{j.delivery.status='unknown';j.delivery.error='发送结果未确认，为避免重复未自动重发';persist(j);return;}
      if(parts.length>1)await new Promise(r=>setTimeout(r,700));
    }j.delivery.status='sent';persist(j);
  }
  async function run(id,controller){
    let j=get(id);const signal=controller.signal;const timer=setTimeout(()=>controller.abort(),j.limits.taskTimeoutSeconds*1000);timer.unref?.();
    try{
      if(!await canSend(eventFor(j))){j.status='cancelled';j.delivery.status='blocked';j.error={code:'PERMISSION_CHANGED',message:'账号或会话权限已改变，未开始处理'};persist(j);return;}
      if(j.limits.useDedicatedCookies[j.source.platform]&&!config.useDedicatedCookies[j.source.platform])throw videoError('CREDENTIAL_REVOKED','专用凭据授权已关闭，未继续获取内容');
      if(!j.content){const cached=db.prepare('SELECT data FROM video_content WHERE key=? AND scope=? AND expires>?').get(j.key,j.scope,now());if(cached){j.content=JSON.parse(cached.data);j.cached=true;}else{
        for(let attempt=0;attempt<2;attempt++)try{j.attempts++;persist(j);j.content=await worker(j.source,{signal,config:j.limits,onStage:row=>{if(signal.aborted)return;j.status=row.stage;if(row.metadata)j.metadata=row.metadata;persist(j);}});break;}catch(e){if(e.code!=='NETWORK'||attempt||signal.aborted)throw e;await new Promise(r=>setTimeout(r,2000));}
        signal.throwIfAborted();db.prepare('INSERT OR REPLACE INTO video_content VALUES(?,?,?,?)').run(j.key,j.scope,now()+config.cacheHours*3600000,JSON.stringify(j.content));}}
      if(!j.content?.segments?.length)throw videoError('NO_TRANSCRIPT','没有取得真实视频正文');
      if(!await canSend(eventFor(j))){j.status='cancelled';j.delivery.status='blocked';persist(j);return;}
      j.source.p=j.content.metadata.p||j.source.p;j.metadata=j.content.metadata;j.status='summarizing';const modelKey=hash([j.key,j.style,getModelKey()]);if(j.summary&&j.summaryKey!==modelKey)j.summary=null;j.summaryKey=modelKey;persist(j);if(!j.summary)j.summary=await summarizeVideo(j.content,{model,getStyle,requestStyle:j.style,signal,onProgress:r=>{j.summaryProgress=r;persist(j);}});
      signal.throwIfAborted();j.status='completed';persist(j);db.prepare('INSERT OR REPLACE INTO video_context VALUES(?,?,?)').run(j.scope,j.id,now());await deliver(j);
    }catch(e){const latest=get(id);if(latest?.status==='cancelled'){j=latest;}else if(closed){if(!['completed','failed','cancelled'].includes(j.status))j.status='queued';persist(j);}else{j.status='failed';j.error={code:signal.aborted?'TIMEOUT':e.code||'VIDEO_ERROR',message:signal.aborted?'视频处理超过时间上限，已停止，普通聊天不受影响':e.code?e.message:'视频处理未完成，未生成推测总结'};persist(j);await deliver(j);}}
    finally{clearTimeout(timer);active.delete(id);kick();}
  }
  async function pump(){
    if(closed||!config.enabled)return;
    expireUnconfirmed();
    for(const row of db.prepare("SELECT data FROM video_jobs WHERE status IN ('completed','failed') AND delivery='pending'").all()){const job=decode(row);if(job.acknowledged)await deliver(job);}
    const queued=db.prepare("SELECT data FROM video_jobs WHERE status='queued' ORDER BY created").all().map(decode);
    for(const j of queued){if(active.size>=config.concurrency)break;if(!j.acknowledged)continue;if([...active.keys()].some(id=>get(id).scope===j.scope))continue;const c=new AbortController();active.set(j.id,c);withTaskTrace(j.timing,()=>run(j.id,c)).catch(()=>{});}
  }
  for(const row of db.prepare("SELECT data FROM video_jobs WHERE status NOT IN ('completed','failed','cancelled') OR delivery='sending'").all()){
    const j=decode(row);if(j.delivery.status==='sending'){j.delivery.status='unknown';j.delivery.error='服务重启时发送结果未知，未自动重发';}if(j.status!=='queued'&&!['completed','failed','cancelled'].includes(j.status)){j.status='queued';j.summary=null;}persist(j);
  }
  // Expired transcript cache and abandoned worker temp files only; no chat or OC material.
  for(const row of db.prepare("SELECT data FROM video_jobs WHERE status='completed'").all()){const j=decode(row);for(const p of j.delivery.parts)if(p.messageId)db.prepare('INSERT OR IGNORE INTO video_messages VALUES(?,?,?)').run(j.scope,String(p.messageId),j.id);}
  function prune(){db.prepare('DELETE FROM video_content WHERE expires<?').run(now());for(const row of db.prepare("SELECT data FROM video_jobs WHERE status IN ('completed','failed','cancelled') AND created<? AND instr(data,'\"content\":')>0").iterate(now()-config.transcriptRetentionDays*86400000)){const j=decode(row);if(j.content){j.metadata=j.content.metadata;delete j.content;if(j.summary)delete j.summary.chunkNotes;j.transcriptExpired=true;persist(j);}}db.exec('PRAGMA wal_checkpoint(PASSIVE)');}
  prune();const pruneTimer=setInterval(()=>{if(!closed&&!active.size)prune();},3600000);pruneTimer.unref?.();const ackTimer=setInterval(()=>{if(!closed)expireUnconfirmed();},60000);ackTimer.unref?.();
  for(const name of await readdir(join(directory,'tmp')).catch(()=>[]))if(/^video-[a-zA-Z0-9]+$/.test(name)){const path=join(directory,'tmp',name);if(now()-(await stat(path)).mtimeMs>config.tempRetentionHours*3600000)await rm(path,{recursive:true,force:true});}
  kick();return {detect,handle,submit,acknowledge,snapshot,setting,get,view,lookup:(event,id)=>view(find(event,id)),list:event=>rows(scopeOf(event),event.selfId).map(view),contextJobs,
    async answer(event,id,question){const j=find(event,id);if(!j?.content||!j.summary||j.status!=='completed')throw Error('当前会话没有可用的视频正文');if(typeof question!=='string'||!question.trim()||question.length>2000)throw Error('视频追问须为 1–2000 字');return {reply:await answerVideo(j.content,j.summary,question,{model,getStyle,signal:AbortSignal.timeout(90000)}),afterSend:delivery=>rememberAnswer(event,j.id,delivery),videoAnswer:true};},
    close(){closed=true;clearInterval(pruneTimer);clearInterval(ackTimer);for(const c of active.values())c.abort();},database:db};
}
