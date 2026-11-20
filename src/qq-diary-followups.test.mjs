import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {openQqCompanion} from './qq-companion.mjs';
import {createDiaryFollowups} from './qq-diary-followups.mjs';

const base={type:'group_message',groupId:'20012',senderId:'10014',selfId:'10015'};
test('purpose extraction reuses the diary call, carries source evidence into outreach, and closes after real acknowledgement',async t=>{
  const f=await fixture(t,{canInitiate:()=>true,analysis:d=>{const row=d.messages.at(-1);return {facts:[],followUp:null,purpose:{kind:'curiosity',topic:'周末跑团的角色卡',nextStep:'问问角色卡准备得怎样',sourceId:row.sourceId,evidence:row.text,confidence:1}};}});
  await f.learn(base,'周末的跑团角色卡我还在准备');assert.equal(f.calls,1);
  const p=f.store.purposes(base)[0];assert.equal(p.status,'pending');assert.match(p.evidence,/角色卡/);
  assert.equal(f.store.purposes({...base,senderId:'10017'}).length,0);f.advance(5*3600000);
  const row=f.store.followupDue()[0];assert.equal(row.kind,'purpose');assert.equal(f.store.purposeFor(row).id,p.id);
  let prompt;await f.worker({analyze:async text=>{prompt=text;return '{"mode":"reply","messages":["角色卡准备得怎样啦？"]}';}}).tick();
  assert.match(prompt,/问问角色卡准备得怎样/);assert.match(prompt,/周末的跑团角色卡我还在准备/);
  assert.equal(f.store.purposes(base)[0].status,'shared');assert.equal(f.calls,1);
  await f.reopen();assert.equal(f.store.purposes(base)[0].status,'shared');
});
test('unproven purposes are rejected and only the same author can dismiss a pending topic',async t=>{
  let id;const f=await fixture(t,{canInitiate:()=>true,analysis:d=>{const row=d.messages.at(-1);return id?{facts:[],purposeUpdates:[{id,status:'dismissed',sourceId:row.sourceId,evidence:row.text}]}:{facts:[],purpose:{kind:'care',topic:'周末安排',nextStep:'问时间',sourceId:row.sourceId,evidence:row.text,confidence:1}};}});
  await f.learn(base,'我的周末安排还没确定');id=f.store.purposes(base)[0].id;
  f.advance(1000);await f.learn({...base,senderId:'10017'},'这个话题我不想继续聊了');assert.equal(f.store.purposes(base)[0].status,'pending');
  f.advance(1000);await f.learn(base,'这个话题我不想继续聊了');assert.equal(f.store.purposes(base)[0].status,'dismissed');
  const bad=await fixture(t,{canInitiate:()=>true,analysis:d=>({facts:[],purpose:{kind:'care',topic:'凭空关心',nextStep:'问时间',sourceId:d.messages.at(-1).sourceId,evidence:'原话没有这句话',confidence:1}})});
  await bad.learn();assert.equal(bad.store.purposes(base).length,0);
});

test('group and private outreach share editable routine and focus, including changes during generation',async t=>{
  for(const event of [base,{...base,type:'private_message'}]){
    const f=await fixture(t);await f.learn(event);f.advance(5*3600000);
    let calls=0,sends=0;
    const w=f.worker({analyze:async()=>{calls++;return '{"mode":"reply","messages":["面试后来怎么样呀？"]}';},send:async()=>{sends++;return {ok:true,messageId:77};}});
    const change=routine=>f.store.update({...f.store.snapshot(),routine});
    change({enabled:true,quietStart:'13:00',quietEnd:'15:00',focus:false});
    assert.deepEqual(await w.tick(),{skipped:true});assert.equal(calls,0);
    change({enabled:false,focus:true});assert.deepEqual(await w.tick(),{skipped:true});assert.equal(calls,0);
    change({enabled:false,focus:false});
    let release;const delayed=f.worker({analyze:()=>new Promise(r=>{calls++;release=r;}),send:async()=>{sends++;return {ok:true,messageId:78};}});
    const run=delayed.tick();while(!release)await new Promise(r=>setImmediate(r));
    change({enabled:false,focus:true});release('{"mode":"reply","messages":["面试后来怎么样呀？"]}');
    assert.deepEqual(await run,{skipped:true});assert.equal(sends,0);assert.equal(calls,1);
  }
});
async function fixture(t,{analysis,canAnalyze=()=>true,canInitiate=()=>false}={}){
  let time=Date.parse('2026-10-28T01:00:00Z'),calls=0;
  const dir=await mkdtemp(join(tmpdir(),'qq-diary-')),path=join(dir,'memory.sqlite');
  const analyze=async prompt=>{
    calls++;const data=JSON.parse(prompt.split('\n').at(-1)),last=data.messages.at(-1);
    return JSON.stringify(analysis?analysis(data):{facts:[{kind:'promise',subject:'job-interview',content:'今天下午去面试，希望晚点聊结果',sourceId:last.sourceId,evidence:last.text,confidence:1}],moments:[],followUp:{sourceId:last.sourceId,evidence:last.text,topic:'今天的面试后来怎么样',confidence:1}});
  };
  let store=await openQqCompanion(path,{now:()=>time,analyze,canAnalyze,canInitiate});
  const workers=[];
  t.after(async()=>{for(const w of workers)w.close();store.close();await rm(dir,{recursive:true,force:true});});
  const f={get store(){return store;},get time(){return time;},get calls(){return calls;},advance(ms){time+=ms;},async reopen(){store.close();store=await openQqCompanion(path,{now:()=>time,analyze,canAnalyze,canInitiate});},worker(options={}){
    const w=createDiaryFollowups({store,now:()=>time,analyze:async()=>'{"mode":"reply","reply":"面试后来怎么样呀？"}',send:async(row,text,id,check)=>{assert.match(id,/^[a-f0-9-]{36}$/);assert.ok(check());return {ok:true,messageId:42};},...options});workers.push(w);return w;
  },async learn(event=base,text='我下午去面试，晚点可以来问我结果'){
    store.observe({...event,text,raw:{message_id:String(time)}},'那等你的好消息');const r=await store.flush({force:true});assert.ok(!r.error,r.error);return r;
  }};return f;
}
test('same extraction writes scoped, dated, evidence-backed diary; recall/reopen need no extra model calls',async t=>{
  const f=await fixture(t);await f.learn();assert.equal(f.calls,1);
  assert.equal(f.store.diaries(base)[0].day,'2026-10-28');assert.match(f.store.diaries(base)[0].evidence,/面试/);
  assert.equal(f.store.diaries({...base,senderId:'10017'}).length,0);
  assert.equal(f.store.diaries({...base,groupId:'10018'}).length,0);
  assert.equal(f.store.diaries({...base,type:'private_message'}).length,0);
  await f.reopen();assert.equal(f.store.diaries(base).length,1);assert.equal(f.calls,1);
  assert.equal(f.store.snapshot().pendingFollowups,1);
});
test('idle follow-up waits, sends once, does not replay after restart, and cancels on incoming/new session',async t=>{
  const f=await fixture(t);await f.learn();assert.deepEqual(await f.worker().tick(),{skipped:true});
  f.advance(5*3600000);assert.equal((await f.worker().tick()).sent,true);assert.deepEqual(await f.worker().tick(),{skipped:true});
  await f.reopen();assert.deepEqual(await f.worker().tick(),{skipped:true});
  f.advance(86400000);await f.learn();f.advance(5*3600000);
  f.store.incoming({...base,raw:{time:f.time/1000}});assert.equal(f.store.followupDue().length,0);
  f.advance(86400000);await f.learn();f.advance(5*3600000);f.store.cancelFollowups(base);assert.equal(f.store.followupDue().length,0);
});
test('quiet hours, busy foreground, disabled AI, repeated content and human interruption suppress idle sends',async t=>{
  const f=await fixture(t);await f.learn();f.advance(5*3600000);
  let calls=0;const noModel=async()=>{calls++;throw Error('must not call');};
  await f.worker({canRun:async()=>false,analyze:noModel}).tick();
  await f.worker({allowed:()=>false,analyze:noModel}).tick();assert.equal(calls,0);
  const repeated=await f.worker({recent:()=>[{at:new Date(f.time-6*3600000).toISOString(),direction:'outgoing',text:'面试后来怎么样呀？'}]}).tick();
  assert.equal(repeated.quiet,true);
  f.advance(86400000);await f.learn();f.advance(15*3600000);assert.deepEqual(await f.worker({analyze:noModel}).tick(),{skipped:true});assert.equal(calls,0);
});
test('in-flight generation is cancelled by new messages or switches and unknown sends never retry',async t=>{
  const f=await fixture(t);await f.learn();f.advance(5*3600000);
  let release,sends=0;const w=f.worker({analyze:()=>new Promise(r=>release=r),send:async()=>{sends++;return {ok:false,status:'unknown'};}});
  const run=w.tick();while(!release)await new Promise(r=>setImmediate(r));
  f.store.incoming({...base,raw:{time:f.time/1000}});release('{"mode":"reply","reply":"面试怎么样"}');await run;assert.equal(sends,0);
  f.advance(86400000);await f.learn();f.advance(5*3600000);
  const unknown=f.worker({send:async()=>{sends++;return {ok:false,status:'unknown'};}});
  assert.equal((await unknown.tick()).sent,false);await unknown.tick();assert.equal(sends,1);
  await f.reopen();await f.worker({send:async()=>{throw Error('must not resend');}}).tick();
});
test('manual correction/forget removes stale diary and pending follow-up without touching other users',async t=>{
  const f=await fixture(t);await f.learn();await f.learn({...base,senderId:'10017'});
  f.store.revise(base,f.store.list(base)[0].id,'面试已取消，不需要跟进');
  assert.equal(f.store.diaries(base).length,0);assert.equal(f.store.diaries({...base,senderId:'10017'}).length,1);
  f.store.forget({...base,senderId:'10017'},'all');assert.equal(f.store.snapshot().diaryEntries,0);assert.equal(f.store.snapshot().pendingFollowups,0);
});
test('fabricated evidence and cross-author follow-ups are rejected; disabling diary keeps facts working',async t=>{
  const f=await fixture(t,{analysis:d=>({facts:[],moments:[{subject:'bad',content:'虚构经历',sourceId:d.messages[0].sourceId,evidence:'根本没有说过',confidence:1}],followUp:{topic:'乱问',sourceId:'foreign',evidence:'错误依据',confidence:1}})});
  await f.learn();assert.equal(f.store.snapshot().diaryEntries,0);assert.equal(f.store.snapshot().pendingFollowups,0);
  const c=f.store.snapshot();f.store.update({...c,diary:false,idleFollowups:false});
  await f.reopen();assert.equal(f.store.snapshot().diary,false);assert.equal(f.store.snapshot().idleFollowups,false);
});
test('ordinary delivered chat schedules daily social outreach without an explicit unfinished promise or another model call',async t=>{
  const user={...base,type:'private_message'};
  const f=await fixture(t,{canInitiate:o=>o.scope==='private:'+base.senderId,analysis:()=>({facts:[],moments:[],followUp:null})});
  await f.learn(user,'上次那个卡住的笑话我还记得');assert.equal(f.calls,1);assert.equal(f.store.snapshot().pendingFollowups,1);
  assert.equal(f.store.armSocialChats(),0);f.advance(5*3600000);assert.equal(f.store.followupDue()[0].kind,'social');
  await f.reopen();assert.equal(f.store.armSocialChats(),0);assert.equal(f.store.snapshot().pendingFollowups,1);
  await f.learn({...user,senderId:'10017'});assert.equal(f.store.snapshot().pendingFollowups,1);
});
test('normal scheduled private/group chats send 1–3 distinct bubbles once and feed the actual delivery back into continuation',async t=>{
  for(const event of [base,{...base,type:'private_message'}]){
    const f=await fixture(t,{canInitiate:()=>true,analysis:()=>({facts:[],followUp:null})});
    await f.learn(event,'前天聊的那个卡顿梗');f.advance(5*3600000);const rows=[],ids=[],confirmed=[];
    const w=f.worker({recent:()=>rows,analyze:async prompt=>{assert.match(prompt,/日常主动聊天/);assert.match(prompt,/前天聊的那个卡顿梗/);return '{"mode":"reply","messages":["上次那个笑话","现在想起来还好笑","你这会儿忙不忙呀"]}';},
      send:async(row,text,id,check)=>{assert.ok(check());assert.ok(!ids.includes(id));ids.push(id);const messageId=String(ids.length);rows.push({messageId,text,at:new Date(f.time).toISOString(),direction:'outgoing'});return {ok:true,messageId};},delivered:async(row,reply)=>confirmed.push(reply)});
    const result=await w.tick();assert.equal(result.messages,3);assert.equal(ids.length,3);assert.equal(confirmed.length,1);
    await w.tick();assert.equal(ids.length,3);assert.equal(f.calls,1);
  }
});
test('a genuine new human message interrupts a scheduled social batch and is never mistaken for its own outgoing bubbles',async t=>{
  const f=await fixture(t,{canInitiate:()=>true,analysis:()=>({facts:[],followUp:null})});await f.learn();f.advance(5*3600000);
  const rows=[];let sent=0;
  const w=f.worker({recent:()=>rows,analyze:async()=>'{"mode":"reply","messages":["上次那个话题","还有一点","你说呢"]}',send:async(row,text,id,check)=>{
    assert.ok(check());sent++;rows.push({messageId:'out',direction:'outgoing',text,at:new Date(f.time).toISOString()},{messageId:'new-human',direction:'incoming',text:'我在呢',at:new Date(f.time).toISOString()});return {ok:true,messageId:'out'};
  }});
  const result=await w.tick();assert.equal(result.status,'partial');assert.equal(sent,1);await w.tick();assert.equal(sent,1);
});
test('daily social quotas survive new exchanges without losing tomorrow\'s eligible topic or flooding multiple groups',async t=>{
  const f=await fixture(t,{canInitiate:()=>true,analysis:()=>({facts:[],followUp:null})});
  const p={...base,type:'private_message'};await f.learn(p);f.advance(5*3600000);assert.equal((await f.worker().tick()).sent,true);
  f.advance(1000);await f.learn(p,'接着刚刚的话题聊了一会儿');f.advance(2*3600000);assert.deepEqual(await f.worker().tick(),{skipped:true});
  f.advance(3600000+1000);assert.equal(f.store.followupDue()[0].kind,'social');assert.equal((await f.worker().tick()).sent,true);
  const groups=await fixture(t,{canInitiate:()=>true,analysis:()=>({facts:[],followUp:null})});
  for(let i=1;i<=11;i++)await groups.learn({...base,groupId:String(20019+i)},'接着刚刚的话题聊聊');groups.advance(5*3600000);
  const w=groups.worker();for(let i=0;i<10;i++){assert.equal((await w.tick()).sent,true);groups.advance(10*60000);}assert.deepEqual(await w.tick(),{skipped:true});
});
test('an acknowledged image/card exchange seeds continuity without extracting invented facts from the bot description',async t=>{
  const f=await fixture(t,{canInitiate:()=>true});
  const event={...base,type:'private_message',text:'',raw:{message_id:'shared-card',message:[{type:'json',data:{data:'untrusted card'}}]}};
  assert.equal(f.store.observe(event,'你刚把我拉进群了呀'),true);assert.equal(f.store.snapshot().pendingFollowups,1);assert.equal(f.store.snapshot().pending,0);
  await f.store.flush({force:true});assert.equal(f.calls,0);assert.equal(f.store.list(event).length,0);assert.match(f.store.context(event).recent,/拉进群/);
});
test('ordinary group reply has no forced @ while manual/explicit participant mentions remain available',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function buildOneBotReplyMessage'),source.indexOf('async function fetchOneBotMessage'));
  const build=vm.runInNewContext(`(${fn})`,{roleplayActive:()=>false,qqStickerDir:'',resolveQqReplyMedia:async()=>[],stripQqImageAttachmentMarkers:x=>x,desktopCall:async(_,p)=>({user_id:p.user_id}),isBannedQqSender:()=>false});
  const normal=await build({...base,raw:{message_id:12}},'你好呀',{quoteSource:false});assert.equal(normal.some(s=>s.type==='at'),false);
  const explicit=await build({...base,autonomyMentions:['10017']},'轮到你了');assert.equal(explicit.filter(s=>s.type==='at').length,1);
});
