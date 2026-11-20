import {adminFetch} from './qq-admin-fetch.mjs';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {openQqCompanion} from '../src/qq-companion.mjs';
import {createDiaryFollowups} from '../src/qq-diary-followups.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';
const root=join(homedir(),'Library/Application Support/CodexRemoteContact'),dir=await mkdtemp(join(tmpdir(),'qq-daily-social-'));
const report={realModel:true,isolatedScopes:true,qqMessagesSent:0,tests:[]};
const profile=await adminFetch('http://127.0.0.1:3789/api/qq/personality').then(r=>r.json());
const model=createGeminiRouterReply({analysis:true,maxTokens:450,timeoutMs:25000});
try{
  for(const type of ['private_message','group_message']){
    let time=Date.parse('2026-10-28T01:00:00Z'),calls=0;const row={type,groupId:type==='group_message'?'20012':undefined,senderId:'10014',selfId:'10015'};
    const store=await openQqCompanion(join(dir,type+'.sqlite'),{now:()=>time,canInitiate:()=>true});let worker;
    try{
      const original='昨天我们聊到你卡住了，结果是你的冷笑话，我还笑了半天。';
      store.observe({...row,text:original,raw:{message_id:'synthetic-old-topic'}},'把你逗笑也算我的隐藏技能啦');
      const history=[{messageId:'synthetic-old-topic',at:new Date(time-1000).toISOString(),direction:'incoming',text:original},{messageId:'synthetic-bot',at:new Date(time).toISOString(),direction:'outgoing',text:'把你逗笑也算我的隐藏技能啦'}];
      time+=5*3600000;const candidates=store.followupDue();assert.equal(candidates[0]?.kind,'social');const sends=[];let output;
      worker=createDiaryFollowups({store,now:()=>time,recent:()=>history,style:()=>profile.enabled?profile.text:'',analyze:async prompt=>{calls++;const r=await model(prompt);output={durationMs:r.durationMs,promptChars:prompt.length,raw:r.text};return r;},send:async(row,text,requestId,guard)=>{
        assert.ok(guard());const messageId='synthetic-'+sends.length;sends.push({text,requestId,messageId});history.push({messageId,text,at:new Date(time).toISOString(),direction:'outgoing'});return {ok:true,messageId};
      }});
      const result=await worker.tick();report.tests.push({type,result,output,sends});assert.equal(result.sent,true,JSON.stringify({result,output}));assert.ok(result.messages>=1&&result.messages<=3);assert.equal(calls,1);
      assert.match(sends.map(m=>m.text).join(' '),/卡|笑话|笑/);assert.doesNotMatch(sends.map(m=>m.text).join(' '),/测试|后台|\[CQ:|\[\[/);
      await worker.tick();assert.equal(calls,1);
      report.tests.at(-1).ok=true;
    }finally{worker?.close();store.close();}
  }
  report.ok=true;
}catch(e){report.ok=false;report.error=e.stack;process.exitCode=1;}
finally{await mkdir(join(root,'runtime/verification'),{recursive:true});const path=join(root,'runtime/verification','qq-daily-social-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({ok:report.ok,error:report.error,tests:report.tests.map(t=>({type:t.type,result:t.result,output:t.sends.map(x=>x.text)})),path}));await rm(dir,{recursive:true,force:true});}
