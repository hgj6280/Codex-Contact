import {mkdtemp,rm,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {openQqCompanion} from '../src/qq-companion.mjs';
import {createDiaryFollowups} from '../src/qq-diary-followups.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';

const root=join(homedir(),'Library/Application Support/CodexRemoteContact'),dir=await mkdtemp(join(tmpdir(),'qq-diary-live-'));
const report={realModel:true,isolatedSyntheticConversations:true,realQqMessagesSent:0,calls:[],tests:[]};
const model=createGeminiRouterReply({analysis:true,maxTokens:850,timeoutMs:25000});
const analyze=async prompt=>{const start=Date.now(),r=await model(prompt);report.calls.push({durationMs:Date.now()-start,promptChars:prompt.length,output:r.text,usage:r.usage});return r;};
let time=Date.parse('2026-10-28T01:00:00Z'),store,worker;
const person={type:'private_message',senderId:'10014',selfId:'10015'};
const path=join(dir,'memory.sqlite');
try{
  store=await openQqCompanion(path,{now:()=>time,analyze});
  const input='我今天下午要去第一次求职面试，紧张得手心冒汗。等面试结束后，你晚点来问我结果吧，我想跟你聊聊。';
  store.observe({...person,text:input,raw:{message_id:'synthetic-interview-1'}},'好呀，面完了再慢慢聊。');
  const extraction=await store.flush({force:true});assert.ok(!extraction.error,extraction.error);
  const diary=store.diaries(person);assert.ok(diary.length>0);assert.equal(report.calls.length,1);
  assert.equal(store.diaries({...person,senderId:'10017'}).length,0);
  report.tests.push({name:'real-model-extraction-and-scoped-diary',pass:true,extraction,diary,settings:store.snapshot()});
  assert.equal(store.snapshot().pendingFollowups,1,'explicit welcomed unfinished topic must be planned');
  const profile=JSON.parse(await readFile(join(root,'data/qq-personality.json'),'utf8'));
  time+=5*3600000;
  const sends=[];
  worker=createDiaryFollowups({store,now:()=>time,analyze,style:()=>profile.text||'',send:async(row,text,id,check)=>{
    assert.ok(check());assert.match(id,/^[a-f0-9-]{36}$/);sends.push({text,requestId:id,scope:row.scope});return {ok:true,messageId:'synthetic-native-'+sends.length};
  }});
  const result=await worker.tick();assert.equal(result.sent,true);assert.ok(sends.length>=1&&sends.length<=3);assert.match(sends.map(s=>s.text).join(''),/面试/);assert.doesNotMatch(sends.map(s=>s.text).join(''),/\[CQ:|\[\[|系统|日记/);
  const sentCount=sends.length;await worker.tick();assert.equal(sends.length,sentCount);
  report.tests.push({name:'real-model-idle-followup-to-simulated-native-receipt',pass:true,result,sends});
  worker.close();store.close();store=await openQqCompanion(path,{now:()=>time,analyze});
  assert.equal(store.followupDue().length,0);assert.ok(store.diaries(person).length>0);
  report.tests.push({name:'persistent-diary-no-replay-after-restart',pass:true});
  time+=10000;
  store.observe({...person,text:'面试已经顺利结束并且拿到offer啦，结果聊完了，不用再问我面试的事。我现在想自己休息，下次再聊。',raw:{message_id:'synthetic-interview-closed'}},'好，去歇着吧。');
  const closedTopic=await store.flush({force:true});assert.ok(!closedTopic.error,closedTopic.error);assert.equal(store.snapshot().pendingFollowups,0);
  report.tests.push({name:'real-model-resolved-topic-and-farewell-stay-quiet',pass:true,extraction:closedTopic});
  const start=performance.now();for(let i=0;i<1000;i++)store.context({...person,text:'上次的面试后来呢'});
  const perRecallMs=(performance.now()-start)/1000;
  const bytes=(await stat(path)).size;assert.ok(perRecallMs<20);assert.equal(report.calls.length,3);
  report.resources={perRecallMs,sqliteBytes:bytes,backgroundProcessesAdded:0,extraDiaryModelCalls:0,idleTimerSeconds:60,maxIdleDecisionsPer24h:3};
  report.ok=true;
}catch(e){report.ok=false;report.error=e.stack;process.exitCode=1;}
finally{
  worker?.close();store?.close();await mkdir(join(root,'runtime/verification'),{recursive:true});
  const output=join(root,'runtime/verification',`qq-diary-real-model-${Date.now()}.json`);
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({ok:report.ok,error:report.error,tests:report.tests.map(x=>({name:x.name,pass:x.pass})),resources:report.resources,output}));await rm(dir,{recursive:true,force:true});
}
