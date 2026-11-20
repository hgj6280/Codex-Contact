import {adminFetch} from './qq-admin-fetch.mjs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {openQqAutonomy} from '../src/qq-autonomy.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';
import {buildCompactGeminiPrompt} from '../src/qq-text-context.mjs';

const dir=await mkdtemp(join(tmpdir(),'qq-continuation-'));
const report={startedAt:new Date().toISOString(),realModel:true,syntheticData:true,qqMessagesSent:0,steps:[]};
let time=Date.now(),calls=0;
const base={type:'group_message',groupId:'20012',senderId:'10014',selfId:'10015'};
try{
  const profile=await adminFetch('http://127.0.0.1:3789/api/qq/personality').then(r=>r.json());
  assert.ok(!profile.text.includes('一句不要超过 20'));
  const store=await openQqAutonomy(join(dir,'state.json'),{now:()=>time,allowed:()=>true,management:{requests:()=>[],act:()=>assert.fail('No actual QQ management')},sendPrivate:()=>assert.fail('No actual QQ send')});
  const model=createGeminiRouterReply({timeoutMs:30000,maxTokens:600});
  async function ask(e){
    const prompt=buildCompactGeminiPrompt({instructions:profile.text,text:e.text})+'\n'+store.prompt(e);
    const started=Date.now();calls++;const raw=await model(prompt),text=await store.consume(e,raw.text);
    assert.equal(e.autonomyActions.length,0);
    report.steps.push({request:e.text,text,continuation:!!e.proactiveDecision?.continuation,durationMs:Date.now()-started,rawPlan:raw.text});
    return text;
  }
  const first={...base,raw:{message_id:1001},text:'周六想去星河剧场跑团，我第一次玩，有点怕接不上大家的戏。'};
  store.observe(first);const a=await ask(first);assert.ok(a.split(/[。！？!?\n]+/).filter(s=>s.trim()).length>=2,a);await store.delivered(first,{reply:a});
  time+=6000;const followup={...base,raw:{message_id:1002},text:'那我如果紧张忘词了怎么办？'};store.observe(followup);
  followup.proactiveDecision=store.candidate(followup);assert.equal(followup.proactiveDecision?.continuation,true);
  const b=await ask(followup);assert.ok(b);await store.delivered(followup,{reply:b});
  time+=31000;const another={...base,senderId:'10017',raw:{message_id:1003},text:'星河剧场跑团能带我自己做的骰子吗？'};store.observe(another);
  another.proactiveDecision=store.candidate(another);assert.equal(another.proactiveDecision?.continuation,false);
  const c=await ask(another);assert.ok(c);await store.delivered(another,{reply:c});
  time+=31000;const offTopic={...base,senderId:'10018',raw:{message_id:1004},text:'股票行情怎么又跌了'};store.observe(offTopic);assert.equal(store.candidate(offTopic),null);
  report.steps.push({stage:'unrelated-topic-no-model-call',pass:true});report.modelCalls=calls;report.ok=true;
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;}
finally{
  const output=join(homedir(),'Library/Application Support/CodexRemoteContact/runtime/verification');await mkdir(output,{recursive:true});
  const path=join(output,'qq-continuation-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...report,reportPath:path}));await rm(dir,{recursive:true,force:true});
}
