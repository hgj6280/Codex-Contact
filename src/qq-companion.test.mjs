import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {openQqCompanion,memoryTerms,safeCompanionContext,isCompanionCommand} from './qq-companion.mjs';
import {handleCompanionRequest} from './qq-companion-api.mjs';
import {isQqConversationAiEnabled} from './qq-conversation-ai.mjs';
const person={type:'group_message',groupId:'20010',senderId:'10012',senderName:'旧昵称'};
const other={...person,senderId:'10019'};
const privatePerson={type:'private_message',senderId:person.senderId};
const say=(base,text)=>({...base,text});
async function fixture(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'qq-companion-'));
  const path=join(directory,'memory.sqlite');let store=await openQqCompanion(path,options);
  t.after(()=>{store.close();return rm(directory,{recursive:true,force:true});});
  return {path,get store(){return store;},async reopen(){store.close();store=await openQqCompanion(path,options);return store;}};
}
function note(store,event,content){return store.command(say(event,'/remember '+content));}

test('routine and fading switches validate atomically, survive restart and never replace facts',async t=>{
  const f=await fixture(t);note(f.store,person,'偏好草莓牛奶');
  const initial=f.store.snapshot();
  assert.equal(initial.routine.quietStart,'23:30');assert.equal(initial.forgetting,true);
  assert.throws(()=>f.store.update({...initial,routine:{quietStart:'24:00'}}),/HH:MM/);
  assert.equal(f.store.snapshot().revision,initial.revision);
  const routine={enabled:true,quietStart:'12:30',quietEnd:'14:00',focus:true};
  f.store.update({...initial,routine,forgetting:false});
  const leaked=f.store.snapshot();leaked.routine.focus=false;assert.equal(f.store.routine().focus,true);
  await f.reopen();assert.deepEqual(f.store.routine(),routine);assert.equal(f.store.snapshot().forgetting,false);
  assert.equal(f.store.list(person).length,1);assert.match(f.store.context(say(person,'草莓牛奶')).memory,/草莓牛奶/);
});

test('explicit memories persist, follow QQ identity across nicknames, and never cross groups/private/users',async t=>{
  const f=await fixture(t);note(f.store,person,'我喜欢草莓牛奶，周六晚上参加跑团');
  assert.equal(f.store.list(person).length,1);assert.equal(f.store.list(other).length,0);
  assert.equal(f.store.list({...person,groupId:'20014'}).length,0);assert.equal(f.store.list(privatePerson).length,0);
  await f.reopen();assert.equal(f.store.recall(say({...person,senderName:'新昵称'},'周六跑团喝什么'))[0].content,'我喜欢草莓牛奶，周六晚上参加跑团');
  const saved=f.store.list(person)[0];f.store.revise(person,saved.id,'我现在喜欢香蕉牛奶');
  assert.equal(f.store.list(person)[0].id,saved.id);assert.match(f.store.context(say(person,'喜欢什么')).memory,/部署者更正/);
  assert.throws(()=>f.store.revise(other,saved.id,'伪造内容'),/不属于/);
  assert.equal(f.store.snapshot().facts,1);assert.match(f.store.context(say(person,'你还记得我吗')).memory,/香蕉/);
  assert.equal((await stat(f.path)).mode&0o777,0o600);
});
test('FTS recall ranks relevant evidence and keeps context bounded; private recent context respects /new',async t=>{
  const {store}=await fixture(t);
  for(let i=0;i<50;i++)note(store,person,`第 ${i} 项日常偏好，喜欢不同的水果编号 ${i}`);
  note(store,person,'我约好周六在星河剧场跑团');
  const rows=store.recall(say(person,'星河剧场跑团在哪天'),{limit:3,budget:200});
  assert.ok(rows.length>=1&&rows.length<=3);assert.match(rows[0].content,/星河剧场/);assert.ok(rows.reduce((n,r)=>n+r.content.length,0)<=200);
  assert.equal(store.recall(say(person,'明天的天气怎么样？')).length,0);
  assert.ok(memoryTerms('在星河剧场跑团').includes('剧场'));
  assert.ok(memoryTerms('我们约好什么时候去哪里跑团').includes('跑团'));
  store.observe(say(privatePerson,'我下周一要参加绘画比赛'),'比赛加油',{at:1000});
  assert.match(store.context(say(privatePerson,'嗯')).recent,/绘画比赛/);
  assert.equal(store.context({...privatePerson,text:'新话题',aiSession:{after:new Date(2000).toISOString()}}).recent,'');
  assert.equal(store.context(say(person,'绘画比赛')).recent,'');
  store.observe(say(other,'我叫小橘，很喜欢草莓牛奶'),'你好呀');
  store.observe(say(other,'今天下雨了'),'带把伞吧');
  store.observe(say(other,'刚刚回到家'),'休息一下');
  assert.match(store.context(say(other,'我叫什么？')).memory,/小橘/);
  assert.match(store.context(say(other,'记得我喜欢喝什么吗')).memory,/草莓牛奶/);
});
test('LLM extraction is background-only, evidence-bound and updates a fact instead of retaining stale duplicates',async t=>{
  let calls=0,next='草莓';
  const {store}=await fixture(t,{analyze:async prompt=>{
    calls++;const data=JSON.parse(prompt.split('\n').at(-1)),last=data.messages.at(-1);
    assert.equal(data.messages.length,2);assert.ok(data.messages.every(m=>!('reply' in m)));
    return JSON.stringify({facts:[{kind:'preference',subject:'favorite-drink',content:`最喜欢${next}牛奶`,sourceId:last.sourceId,evidence:last.text,confidence:.95},
      {kind:'profile',subject:'injected',content:'从没说过的身份',sourceId:'foreign',evidence:'假证据',confidence:1}],mood:{sourceId:last.sourceId,valence:.8,arousal:.5,confidence:.9}});
  }});
  store.observe(say(person,'我比较喜欢甜味牛奶'),'知道啦');store.observe(say(person,'我最喜欢草莓牛奶'),'记住这个偏好');assert.equal(calls,0);
  assert.equal((await store.flush({force:true})).accepted,1);assert.equal(calls,1);assert.equal(store.list(person).length,1);
  assert.match(store.context(say(person,'聊聊')).social,/情绪效价 0.8/);
  next='香蕉';store.observe(say(person,'我最近换了口味'),'嗯嗯');store.observe(say(person,'我现在最喜欢香蕉牛奶'),'那换成香蕉的');
  await store.flush({force:true});assert.equal(store.list(person).length,1);assert.match(store.list(person)[0].content,/香蕉/);
  assert.ok(!store.context(say(person,'喜欢什么')).memory.includes('草莓牛奶'));
});
test('failed/invalid analysis never blocks existing context or hot-loops; drafts, images, commands and secrets never seed memory',async t=>{
  let calls=0;const {store}=await fixture(t,{analyze:async()=>{calls++;throw Error('quota exhausted');}});
  for(const event of [{...person,desktopDraft:true,text:'草稿测试'},{...person,imageGeneration:{},text:'生成一张图'},say(person,'/new'),say(person,'我的密码：secret123')])assert.equal(store.observe(event,'回复'),false);
  note(store,person,'我喜欢画画');store.observe(say(person,'周末我要画画'),'好呀');store.observe(say(person,'准备好画笔了'),'嗯嗯');
  assert.ok((await store.flush({force:true})).error);assert.equal(calls,1);
  await store.flush({force:true});assert.equal(calls,1);assert.match(store.context(say(person,'我喜欢啥')).memory,/画画/);
  assert.equal(store.snapshot().pending,0);
  assert.match(store.command(say(person,'/remember api_key=abcdefghijklmno')).reply,/不写入/);
  assert.equal(store.observe(say(person,'My password: super-secret-value'),'收到'),false);
  assert.deepEqual(safeCompanionContext({context(){throw Error('disk');}},person),{memory:'',social:''});
});
test('forget only removes this owner, prevents resurrection after restart and cancels stale in-flight extraction',async t=>{
  let time=10000,release;
  const f=await fixture(t,{now:()=>time,analyze:prompt=>new Promise(resolve=>{release=()=>{const data=JSON.parse(prompt.split('\n').at(-1)),source=data.messages[0];resolve(JSON.stringify({facts:[{kind:'profile',subject:'old-note',content:source.text,evidence:source.text,sourceId:source.sourceId,confidence:1}]}));};})});
  note(f.store,person,'我喜欢苹果');note(f.store,other,'我喜欢橘子');
  f.store.observe(say(person,'我周末喜欢画画'),'了解');
  const running=f.store.flush({force:true});assert.ok(release);
  time++;assert.equal(f.store.forget(person,'all'),1);release();await running;
  assert.equal(f.store.list(person).length,0);assert.equal(f.store.list(other).length,1);
  await f.reopen();assert.equal(f.store.observe(say(person,'我喜欢苹果'),'旧回复',{seed:true,at:10000}),false);
  assert.equal(f.store.context(say(person,'以前说了啥')).memory,'');
  const foreign=f.store.list(other)[0].id;assert.equal(f.store.forget(person,foreign),0);assert.equal(f.store.list(other).length,1);
});
test('feature switches persist, stale writes fail, and emotion decays without changing identity or triggering sends',async t=>{
  let time=10000;
  const f=await fixture(t,{now:()=>time,analyze:async prompt=>{const data=JSON.parse(prompt.split('\n').at(-1));return JSON.stringify({facts:[],mood:{sourceId:data.messages.at(-1).sourceId,valence:-.8,arousal:.6,confidence:.95}});}});
  f.store.observe(say(person,'今天心情有点低落'),'陪你聊会儿');await f.store.flush({force:true});
  assert.match(f.store.context(say(person,'嗯')).social,/情绪效价 -0.8/);time+=24*3600000;
  assert.doesNotMatch(f.store.context(say(person,'新的一天')).social,/情绪效价/);
  const old=f.store.snapshot();f.store.update({...old,enabled:false});assert.throws(()=>f.store.update({...old,emotion:false}),/已更新/);
  assert.equal(f.store.context(person).memory,'');assert.equal(f.store.observe(say(person,'新记忆'),'回复'),false);
  await f.reopen();assert.equal(f.store.snapshot().enabled,false);
});
test('natural follow-up is one bounded same-human, same-topic question; bans and per-chat switches remain authoritative',async t=>{
  let time=10000;const {store}=await fixture(t,{now:()=>time});
  store.observe(say(person,'周六星河剧场跑团怎么报名'),'星河剧场跑团在群公告报名');time+=6000;
  const question=say(person,'星河剧场跑团是周六晚上吗？');const decision=store.followup(question);assert.equal(decision.ok,true);
  assert.equal(store.followup({...question,senderId:other.senderId}),null);
  assert.equal(store.followup({...question,atTargets:['10010']}),null);
  assert.equal(store.followup({...question,replyContext:{senderId:other.senderId,isSelf:false}}),null);
  assert.equal(store.followup(say(person,'这款手机怎么样？')),null);
  assert.equal(store.followup(say(person,'哈哈哈哈')),null);
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8'),start=source.indexOf('function shouldRespondToQq(event)'),end=source.indexOf('\nfunction ',start+10);
  const state={channels:{qq:true},qq:{groupMode:'mention-only',enhancer:{enabled:false},disabledConversations:[]}};
  const check=(event,banned=false)=>vm.runInNewContext(source.slice(start,end)+'\nshouldRespondToQq(event)',{
    state,event,roleplay:{},qqCompanion:store,qqImageSearch:{mode:()=>false},isImageGenerationRequest:()=>false,isCompanionCommand,isQqConversationAiEnabled,isBannedQqSender:()=>banned,hasUnhandledQqAudio:()=>false,
    aiGroups:()=>[person.groupId],aiUsers:()=>[],stripMentionText:t=>t,isQqModelQuestion:()=>false,parseModerationCommand:()=>null,matchQqTrigger:()=>null,hasPendingQqImageRequest:()=>false,isMentionEvent:e=>e.mentioned});
  assert.equal(check(question).ok,true);assert.equal(check(question,true).ok,false);
  state.qq.disabledConversations=[person.groupId];assert.equal(check(question).ok,false);state.qq.disabledConversations=[];
  store.observe({...question,proactiveDecision:decision},'是周六');time+=6000;assert.equal(store.followup(question),null);
  time+=60000;assert.equal(store.followup(question),null);
  assert.equal(check(say(person,'/memory')).ok,true);assert.equal(check({...question,mentioned:true}).ok,true);
});
test('local memory API rejects cross-site requests, unlisted groups and mismatched private owners',async t=>{
  const {store}=await fixture(t);note(store,person,'我喜欢猫');
  const request=async(url,{method='GET',local=true,site,body={}}={})=>{
    let output;await handleCompanionRequest({url,method,headers:{'sec-fetch-site':site}},null,{store,isLocalRequest:()=>local,
      assertAccess:id=>{if(![person.groupId,`private:${person.senderId}`].includes(id))throw Error('not allowed');},
      readBody:async()=>body,sendJson:(_r,status,data)=>output={status,data}});return output;
  };
  const url=`/api/qq/companion/memories?conversationId=${person.groupId}&userId=${person.senderId}`;
  assert.equal((await request(url)).data.memories.length,1);
  assert.equal((await request(url,{local:false})).status,403);assert.equal((await request(url,{site:'cross-site'})).status,403);
  assert.equal((await request('/api/qq/companion/memories?conversationId=999999&userId='+person.senderId)).status,400);
  assert.equal((await request(`/api/qq/companion/memories?conversationId=private:${person.senderId}&userId=${other.senderId}`)).status,400);
  note(store,privatePerson,'私聊自己的偏好');
  assert.equal((await request('/api/qq/companion/settings',{method:'POST',body:{...store.snapshot(),enabled:false}})).status,200);
  store.clearConversation(person.groupId);assert.equal(store.list(person).length,0);
  assert.equal(store.list(privatePerson).length,1);
  store.clearConversation();assert.equal(store.list(privatePerson).length,0);
});
test('transient model failures preserve pending memory and pause analysis while ordinary interaction context remains usable',async t=>{
  let paused=false,calls=0;const {store}=await fixture(t,{canRunAnalysis:()=>!paused,analyze:async()=>{calls++;if(calls===1)throw Object.assign(Error('temporary upstream'),{status:503});return '{"facts":[],"mood":null}';}});
  store.observe(say(person,'明天想试试新的画笔'),'那下次聊聊手感');assert.equal(store.snapshot().pending,1);
  await store.flush({force:true});assert.equal(store.snapshot().pending,1);paused=true;
  await store.flush({force:true});assert.equal(calls,1);assert.match(store.context(say(person,'刚刚聊了啥')).recent,/画笔/);
  paused=false;await store.flush({force:true});assert.equal(calls,2);assert.equal(store.snapshot().pending,0);
});
test('bounded recall is small and fast without embedding servers or model calls',async t=>{
  const {store,path}=await fixture(t);
  for(let i=0;i<180;i++)note(store,person,`我收藏第 ${i} 号画集，主题是森林狐狸和星空 ${i}`);
  const start=performance.now();for(let i=0;i<100;i++)assert.ok(store.context(say(person,'星空狐狸画集')).memory.length<1600);
  const perRecallMs=(performance.now()-start)/100;
  assert.ok(perRecallMs<30,`recall ${perRecallMs}ms`);
  const bytes=(await stat(path)).size;assert.ok(bytes<2*1024*1024);
  t.diagnostic(JSON.stringify({perRecallMs,sqliteBytes:bytes}));
});

test('a sparse single self-disclosure is learned after debounce; legacy seeds never schedule bulk model calls',async t=>{
  let calls=0;const {store}=await fixture(t,{delayMs:5,analyze:async()=>{calls++;return '{"facts":[],"mood":null}';}});
  store.observe(say(person,'以前我喜欢看星空'),'旧回复',{seed:true,at:Date.now()-1000});
  store.resume();await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);assert.equal(store.snapshot().pending,0);
  store.observe(say(person,'我最喜欢喝草莓牛奶'),'记下来啦');await new Promise(r=>setTimeout(r,30));
  assert.equal(calls,1);assert.equal(store.snapshot().pending,0);
});

test('memory dates use Beijing time across midnight rather than the execution host timezone',async t=>{
  const {store}=await fixture(t,{now:()=>Date.parse('2026-10-24T16:01:00Z')});
  note(store,person,'我约好明天去跑团');assert.match(store.context(say(person,'记得约定吗')).memory,/2026-10-25/);
});

test('disabled conversations and banned authors also stop queued background learning',async t=>{
  let allowed=false,calls=0;
  const {store}=await fixture(t,{canAnalyze:()=>allowed,analyze:async()=>{calls++;return '{"facts":[],"mood":null}';}});
  store.observe(say(person,'我喜欢清晨喝茶'),'知道了');
  assert.equal((await store.flush({force:true})).skipped,true);assert.equal(calls,0);
  allowed=true;await store.flush({force:true});assert.equal(calls,1);
});
