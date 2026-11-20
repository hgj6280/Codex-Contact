import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseVideoUrl,extractVideoSources,parseVideoCommand,stripVideoAddress} from './qq-video-input.mjs';
import {allowedVideoHost,publicVideoIPv4} from './qq-video-network.mjs';
import {openVideoJobs} from './qq-video-jobs.mjs';
import {summarizeVideo,answerVideo,transcriptChunks,retrieveVideoTranscript,videoTextSegments} from './qq-video-summary.mjs';
import {invokeVideoTool} from './qq-video-tools.mjs';
import {buildVideoModelArgs,createVideoModelRouter} from './qq-video-model.mjs';
import {createQqTextFailover} from './qq-text-failover.mjs';
import {createGeminiRouterReply} from './qq-gemini-router.mjs';
import {isImageGenerationRequest} from './qq-codex-images.mjs';
const source=parseVideoUrl('https://www.bilibili.com/video/BV1JqxT6HEkc/?p=2');
const content={metadata:{platform:'bilibili',id:source.id,p:2,partCount:3,title:'真实测试正文',duration:20,url:source.url},mode:'subtitles',visualAnalysis:false,segments:[{start:0,end:5,text:'第一点需要先关电源。'},{start:6,end:12,text:'第二点接上蓝色线，再按确认键。'},{start:13,end:20,text:'最后确认设备亮绿灯，才能完成。'}]};
const event=(id='1',groupId='20011',senderId='10012')=>({type:'group_message',groupId,senderId,selfId:'10011',hasSelfAtSegment:true,raw:{message_id:id},text:'总结 '+source.url});
async function until(fn){for(let i=0;i<120;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('timed out');}
async function fixture(t,options={}){const dir=await mkdtemp(join(tmpdir(),'qq-video-tests-')),sent=[],prompts=[];const jobs=await openVideoJobs(dir,{worker:async()=>structuredClone(content),model:async p=>{prompts.push(p);return {text:'先关电，接蓝线并确认；[0:13] 最后亮绿灯。'};},send:async(e,text)=>{sent.push({e,text});return {ok:true,messageId:String(100+sent.length),verified:true};},...options});t.after(async()=>{jobs.close();await until(()=>jobs.snapshot().active===0);jobs.database.close();await rm(dir,{recursive:true,force:true});});return {jobs,dir,sent,prompts};}

test('three platforms, CN Douyin share text, Shorts and Bilibili parts normalize without playlist expansion',()=>{
  assert.equal(extractVideoSources({text:'总结 BV1JqxT6HEkc P2'})[0].p,2);
  assert.equal(parseVideoUrl('https://b23.tv/BV1JqxT6HEkc').url,'https://b23.tv/BV1JqxT6HEkc');
  assert.equal(parseVideoUrl('https://youtu.be/jNQXAC9IVRw?list=bad').url,'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(parseVideoUrl('https://www.youtube.com/shorts/BGQWPY4IigY').platform,'youtube');
  assert.equal(extractVideoSources({text:'7.45 复制打开抖音，看看作品 https://v.douyin.com/AbcDefG/ 11/01'})[0].platform,'douyin');
  for(const url of ['file:///etc/passwd','http://127.0.0.1:3789','https://youtube.com.evil.test/watch?v=jNQXAC9IVRw','https://www.youtube.com/playlist?list=1','https://www.bilibili.com/video/BV1JqxT6HEkc/?p=-1','https://www.tiktok.com/@a/video/123456789012'])assert.throws(()=>parseVideoUrl(url));
});
test('only actual same-chat quoted content and share card fields can provide a video',()=>{
  const e={...event(),text:'总结这个',hasReplySegment:true,replyContext:{text:source.url,raw:{group_id:20010}}};assert.equal(extractVideoSources(e).length,0);
  e.replyContext.raw.group_id=e.groupId;assert.equal(extractVideoSources(e)[0].p,2);
  e.replyContext=null;e.raw.message=[{type:'json',data:{data:JSON.stringify({meta:{news:{jumpUrl:source.url}}})}}];assert.equal(extractVideoSources(e).length,1);
});
test('auto-off is silent for naked links, auto-on triggers, negatives and own events never submit',()=>{
  assert.equal(parseVideoCommand({...event(),text:source.url}),null);
  assert.equal(parseVideoCommand({...event(),text:source.url},{auto:true}).action,'submit');
  assert.equal(parseVideoCommand({...event(),senderId:'10011'},{auto:true}),null);
  assert.equal(parseVideoCommand({...event(),text:'不要总结 '+source.url}),null);
  assert.equal(parseVideoCommand({...event(),text:'总结这个',hasReplySegment:true}).action,'missing');
  assert.equal(parseVideoCommand({...event(),text:'这个总结太差了 '+source.url}),null);
  assert.equal(parseVideoCommand({...event(),text:'2026年度总结 '+source.url}),null);
  assert.equal(parseVideoCommand({...event(),text:'',raw:{message:[{type:'json',data:{data:JSON.stringify({title:'总结这个视频',url:source.url})}}]}}),null);
  assert.equal(parseVideoCommand({...event(),text:'狐宫静总结 '+source.url},{stripMentions:t=>t.replace('狐宫静','')}).action,'submit');
});
test('real QQ text segments accept a video before the instruction without enabling automatic summaries',()=>{
  const rawText='BV1djx46iE8U总结这个视频';
  const e={...event(),text:'[CQ:at,qq=10011] '+rawText,raw:{message_id:'parser-regression',message:[{type:'at',data:{qq:'10011'}},{type:'text',data:{text:rawText}}]}};
  assert.equal(parseVideoCommand(e).action,'submit');
  assert.equal(parseVideoCommand(e).sources[0].id,'BV1djx46iE8U');
  const typed={...event(),text:'@狐宫静 BV1djx46iE8U总结这个视频',raw:{message:[{type:'text',data:{text:'@狐宫静 BV1djx46iE8U总结这个视频'}}]}};
  assert.equal(parseVideoCommand(typed,{stripMentions:t=>t.replaceAll('狐宫静','')}).action,'submit');
  assert.equal(parseVideoCommand(typed,{stripMentions:t=>stripVideoAddress(t,['狐宫静'])}).action,'submit');
  assert.equal(stripVideoAddress('@狐宫静静 总结',['狐宫静','狐宫静静']),'总结');
  assert.equal(parseVideoCommand({...typed,raw:{},text:'@别的人 BV1djx46iE8U总结这个视频'},{stripMentions:t=>t.replaceAll('狐宫静','')}),null);
  for(const text of ['BV1djx46iE8U 总结这个视频','https://www.bilibili.com/video/BV1djx46iE8U/?p=2 总结这个视频','https://youtu.be/jNQXAC9IVRw 总结一下','BV1djx46iE8U 请帮我详细总结'])assert.equal(parseVideoCommand({...event(),text}).action,'submit');
  for(const text of ['BV1djx46iE8U','BV1djx46iE8U 不用总结','BV1djx46iE8U 这个总结太差了','BV1djx46iE8U 2026年度总结'])assert.equal(parseVideoCommand({...event(),text}),null);
});
test('source-first messages run through the asynchronous video pipeline instead of ordinary chat',async t=>{
  const f=await fixture(t),e={...event('source-first'),text:'BV1djx46iE8U总结这个视频'};
  const result=await f.jobs.handle(e);assert.equal(result.task.videoId,'BV1djx46iE8U');
  await result.afterSend();await until(()=>f.jobs.get(result.task.id).delivery.status==='sent');
  assert.equal(f.jobs.get(result.task.id).status,'completed');assert.equal(f.sent[0].e.groupId,e.groupId);assert.equal(f.jobs.get(result.task.id).sourceId,'source-first');
});
test('video model reuses transient route health with an isolated fallback, preserving cancellation and permanent errors',async()=>{
  let calls=0;const codexCalls=[];
  const primaryRoute=createQqTextFailover({primary:async()=>{},fallback:async()=>{throw Error('normal tool-enabled fallback must not run');}});
  const router=createVideoModelRouter({selection:()=>({gemini:true,model:'gpt-6.1-sol'}),primaryRoute,primary:async()=>{calls++;throw Object.assign(Error('unavailable'),{status:503});},codex:async(p,o)=>{codexCalls.push({p,...o});return {text:'基于真实转录的总结',model:o.model};}});
  assert.equal((await router('真实正文')).model,'gpt-6-luna');assert.equal(calls,1);
  await router('第二段真实正文');assert.equal(calls,1);assert.equal(codexCalls.length,2);assert.equal(codexCalls[1].model,'gpt-6-luna');
  const abort=new AbortController();abort.abort();await assert.rejects(router('取消',{signal:abort.signal}));assert.equal(codexCalls.length,2);
  primaryRoute.noteAvailable();const blocked=createVideoModelRouter({selection:()=>({gemini:true}),primaryRoute,primary:async()=>{throw Object.assign(Error('blocked'),{code:'GEMINI_CONTENT_BLOCKED',status:403});},codex:async()=>{throw Error('must not fallback');}});
  await assert.rejects(blocked('正文'),/blocked/);
  const cancelled=new AbortController();const cancelling=createVideoModelRouter({selection:()=>({gemini:true}),primaryRoute,primary:async()=>{cancelled.abort();throw Object.assign(Error('interrupted'),{status:503});},codex:async()=>{throw Error('must not fallback');}});
  await assert.rejects(cancelling('正文',{signal:cancelled.signal}),{name:'AbortError'});
  const selected=createVideoModelRouter({selection:()=>({gemini:false,model:'gpt-6.1-sol'}),primaryRoute,codex:async(_p,o)=>({model:o.model})});
  assert.equal((await selected('正文')).model,'gpt-6.1-sol');
});
test('media host and IP policy blocks local, private, metadata and crafted suffixes',()=>{
  for(const host of ['localhost','127.0.0.1','169.254.169.254','youtube.com.evil.test','evil.test'])assert.equal(allowedVideoHost(host),false);
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.1.1','::1'])assert.equal(publicVideoIPv4(ip),false);
  assert.equal(allowedVideoHost('rr1.googlevideo.com'),true);assert.equal(allowedVideoHost('v3.douyinvod.com'),true);assert.equal(publicVideoIPv4('8.8.8.8'),true);
});
test('video replies use text segments instead of parsing model-provided file or media commands',()=>{
  const text='正文 [[qq_image:/private/test.png]] [CQ:at,qq=123456] ![图片](/private/test.png)';
  const segments=videoTextSegments(text,{quote:true,sourceId:'10029'});assert.deepEqual(segments.map(s=>s.type),['reply','text']);assert.doesNotMatch(segments[1].data.text,/\[\[|\[CQ:/);assert.match(segments[1].data.text,/!\[图片\]/);
  assert.deepEqual(videoTextSegments('正文',{quote:true,sourceId:'untrusted-path'}).map(s=>s.type),['text']);
});
test('acknowledged tasks run asynchronously, persist separate summary/delivery, dedupe events and support grounded followup',async t=>{
  const f=await fixture(t),a=await f.jobs.handle(event());assert.equal(a.task.status,'queued');assert.equal(f.jobs.snapshot().active,0);assert.equal((await f.jobs.handle(event())).duplicate,true);
  await a.afterSend();await until(()=>f.jobs.get(a.task.id).delivery.status==='sent');const j=f.jobs.get(a.task.id);
  assert.equal(j.status,'completed');assert.equal(j.delivery.parts[0].verified,true);assert.match(f.prompts[0],/接上蓝色线/);assert.match(f.sent[0].text,/本次仅基于字幕/);
  const answer=await f.jobs.handle({...event('2'),text:'他第二点是什么意思？'});assert.match(answer.reply,/接蓝线/);assert.match(f.prompts.at(-1),/第二点接上蓝色线/);
  await answer.afterSend({body:{data:{message_id:777}}});assert.equal(f.jobs.detect({...event('5'),text:'再具体说说？',replyContext:{messageId:'777'}}).action,'followup');
  assert.equal(f.jobs.detect({...event('3'),hasSelfAtSegment:false,text:'他说的对吗'}),null);
  assert.equal(f.jobs.detect({...event('4'),hasSelfAtSegment:false,text:'屏幕怎么样？',replyContext:{messageId:j.delivery.parts[0].messageId}}).action,'followup');
});
test('two simultaneous groups retain their own content, reply destination and followup transcript',async t=>{
  const f=await fixture(t,{worker:async s=>{await new Promise(r=>setTimeout(r,30));return {...structuredClone(content),metadata:{...content.metadata,id:s.id},segments:[{start:0,end:10,text:s.id==='BV1JqxT6HEkc'?'甲视频的独有内容':'乙视频的独有内容'}]};},model:async p=>({text:p.includes('甲视频的独有内容')?'甲视频内容':'乙视频内容'})});
  f.jobs.setting({concurrency:2});const a=await f.jobs.handle(event()),b=await f.jobs.handle({...event('2','20010'),text:'总结 BV1bK411W797'});await a.afterSend();await b.afterSend();
  await until(()=>f.jobs.get(a.task.id).delivery.status==='sent'&&f.jobs.get(b.task.id).delivery.status==='sent');
  assert.match(f.sent.find(s=>s.e.groupId==='20011').text,/甲视频内容/);assert.doesNotMatch(f.sent.find(s=>s.e.groupId==='20011').text,/乙视频内容/);
  assert.match(f.sent.find(s=>s.e.groupId==='20010').text,/乙视频内容/);
});
test('per-group jobs and private contexts do not mix; cross-group task IDs and spoofed tool identities are refused',async t=>{
  const f=await fixture(t);const a=await f.jobs.handle(event());await a.afterSend();await until(()=>f.jobs.get(a.task.id).status==='completed');
  const other=await f.jobs.handle({...event('2','20010'),text:'/视频 结果 '+a.task.id});assert.match(other.reply,/没有找到/);
  assert.equal(f.jobs.detect({...event('3','20010'),text:'最后得出了什么结论？'}),null);
  await assert.rejects(invokeVideoTool(f.jobs,event(),'video_submit',{url:source.url,groupId:'20010'}),/不能接收/);
  await assert.rejects(invokeVideoTool(f.jobs,{...event(),text:'普通消息'},'video_submit',{url:source.url}),/必须来自/);
  const otherAccount={...event('3'),selfId:'10019',text:'他第二点是什么意思？'};assert.deepEqual(f.jobs.list(otherAccount),[]);assert.equal(f.jobs.detect(otherAccount),null);await assert.rejects(invokeVideoTool(f.jobs,otherAccount,'video_read',{id:a.task.id}),/没有唯一/);
});
test('only submitter can cancel and cancellation prevents result delivery',async t=>{
  const f=await fixture(t,{worker:(_s,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))});const a=await f.jobs.handle(event());await a.afterSend();await until(()=>f.jobs.snapshot().active===1);
  assert.match((await f.jobs.handle({...event('2','20011','10024'),text:'/视频 取消 '+a.task.id})).reply,/自己/);
  await f.jobs.handle({...event('3'),text:'/视频 取消 '+a.task.id});await until(()=>f.jobs.snapshot().active===0);assert.equal(f.jobs.get(a.task.id).status,'cancelled');assert.equal(f.sent.length,0);
});
test('failed extraction never calls summary model; uncertain send is not retried',async t=>{
  const f=await fixture(t,{worker:async()=>{throw Object.assign(Error('需要专用登录'),{code:'LOGIN_REQUIRED'});}});const a=await f.jobs.handle(event());await a.afterSend();await until(()=>f.jobs.get(a.task.id).delivery.status==='sent');assert.equal(f.prompts.length,0);assert.equal(f.jobs.get(a.task.id).status,'failed');assert.match(f.sent[0].text,/需要专用登录/);
  const g=await fixture(t,{send:async()=>{throw Error('network result unknown');}});const b=await g.jobs.handle(event());await b.afterSend();await until(()=>g.jobs.get(b.task.id).delivery.status==='unknown');assert.equal(g.jobs.get(b.task.id).status,'completed');
});
test('every long-video chunk and final segment reaches a model; no visual-analysis claims are permitted',async()=>{
  const long={...content,segments:Array.from({length:80},(_,i)=>({start:i*10,end:i*10+9,text:(i===79?'全片最后的真实结论。':'正文内容。').repeat(40)}))},calls=[];
  const summary=await summarizeVideo(long,{model:async p=>{calls.push(p);return {text:'合并后的总结'};},signal:AbortSignal.timeout(5000)});
  assert.ok(summary.chunks>1);assert.ok(calls.some(p=>p.includes('全片最后的真实结论')));assert.equal(summary.coverage.processedSegments,80);assert.equal(summary.visualAnalysis,false);
  assert.match(retrieveVideoTranscript(long,'最后是什么结论？'),/全片最后/);
  const split=transcriptChunks([{start:0,end:1,text:'字'.repeat(30000)}]);assert.ok(split.length>1);assert.ok(split.every(p=>p.length<=8500));assert.equal(split.join('').match(/字/g).length,30000);
  await assert.rejects(answerVideo(content,{text:'摘要'},'第二点？',{model:async()=>({text:'[[qq_image:/private/test.png]]'}),signal:AbortSignal.timeout(1000)}),/有效/);
});
test('same-scope identical video/style reuses content and summary without another download or model call',async t=>{
  let reads=0;const f=await fixture(t,{worker:async()=>{reads++;return structuredClone(content);}});const a=await f.jobs.handle(event());await a.afterSend();await until(()=>f.jobs.get(a.task.id).delivery.status==='sent');const calls=f.prompts.length;
  const b=await f.jobs.handle(event('2'));await b.afterSend();await until(()=>f.jobs.get(b.task.id).delivery.status==='sent');assert.equal(reads,1);assert.equal(f.prompts.length,calls);assert.equal(f.jobs.get(b.task.id).cached,true);
});
test('video Codex args disable host tools/config/memory and retain the selected model and speed options',()=>{
  const args=buildVideoModelArgs({model:'gpt-6-luna',reasoningEffort:'low',fastMode:true,cwd:'/tmp/example',outputPath:'/tmp/out'});
  assert.equal(args[args.indexOf('-m')+1],'gpt-6-luna');assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--ignore-rules'));assert.ok(args.includes('service_tier="fast"'));
  for(const tool of ['shell_tool','apps','memories','browser_use','computer_use','multi_agent','image_generation'])assert.ok(args.some((v,i)=>v==='--disable'&&args[i+1]===tool));
});
test('video cancellation aborts the existing Gemini HTTP request without changing ordinary callers',async()=>{
  const c=new AbortController();let signal;const request=createGeminiRouterReply({readConfig:async()=>({models:{providers:{antigravity9router:{baseUrl:'http://127.0.0.1:20128/v1',apiKey:'fixture'}}}}),fetchImpl:async(_u,o)=>{signal=o.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const result=request('真实视频正文',{signal:c.signal});await until(()=>signal);c.abort(Error('test cancellation'));await assert.rejects(result,/test cancellation/);assert.equal(signal.aborted,true);
});
test('restart recovers interrupted work without a spurious timeout reply',async t=>{
  const f=await fixture(t,{worker:(_s,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('shutdown')),{once:true}))});const a=await f.jobs.handle(event());await a.afterSend();await until(()=>f.jobs.snapshot().active===1);f.jobs.close();await until(()=>f.jobs.snapshot().active===0);assert.equal(f.jobs.get(a.task.id).status,'queued');assert.equal(f.sent.length,0);
  const sent=[],resumed=await openVideoJobs(f.dir,{worker:async()=>structuredClone(content),model:async()=>({text:'恢复后的真实正文总结'}),send:async(_e,text)=>{sent.push(text);return {ok:true,messageId:'888'};}});
  try{await until(()=>resumed.get(a.task.id).delivery.status==='sent');assert.equal(sent.length,1);assert.match(sent[0],/恢复后的真实正文/);}finally{resumed.close();await until(()=>resumed.snapshot().active===0);resumed.database.close();}
});
test('unconfirmed acknowledgments expire without executing video processing',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now});const a=await f.jobs.handle(event());now+=301000;await f.jobs.handle(event('2'));assert.equal(f.jobs.get(a.task.id).error.code,'ACK_UNCONFIRMED');assert.equal(f.jobs.get(a.task.id).attempts,0);assert.equal(f.sent.length,0);
});
test('video followup leaves explicit image generation to the existing image pipeline',async t=>{
  const f=await fixture(t,{isImageRequest:e=>isImageGenerationRequest(e.text)}),a=await f.jobs.handle(event());await a.afterSend();await until(()=>f.jobs.get(a.task.id).delivery.status==='sent');
  const draw={...event('2'),text:'生成一张这个视频里的狐宫静图片',replyContext:{messageId:f.jobs.get(a.task.id).delivery.parts[0].messageId}};
  assert.equal(isImageGenerationRequest(draw.text),true);assert.equal(f.jobs.detect(draw),null);
});
test('revoked conversation access stops a queued job before download or model use',async t=>{
  let allowed=true,downloads=0;const f=await fixture(t,{canSend:async()=>allowed,worker:async()=>{downloads++;return content;}}),a=await f.jobs.handle(event());allowed=false;await a.afterSend();await until(()=>f.jobs.get(a.task.id).status==='cancelled');assert.equal(downloads,0);assert.equal(f.prompts.length,0);assert.equal(f.sent.length,0);
});
