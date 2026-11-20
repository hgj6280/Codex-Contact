import {adminFetch} from './qq-admin-fetch.mjs';
import {mkdtemp,readFile,writeFile,rm,mkdir,realpath} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {openQqAutonomy} from '../src/qq-autonomy.mjs';
import {selectQqContext,QQ_CONTEXT_POLICY} from '../src/qq-context-window.mjs';
import {buildCompactGeminiPrompt} from '../src/qq-text-context.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';

const root=join(homedir(),'Library/Application Support/CodexRemoteContact'),dir=await mkdtemp(join(tmpdir(),'qq-context-budget-'));
const report={startedAt:new Date().toISOString(),realModel:true,syntheticData:true,qqMessagesSent:0,policy:QQ_CONTEXT_POLICY,cases:[]};
try{
  const active=await realpath(join(root,'service-code'));report.baselineRelease=active;
  const {openQqAutonomy:openOld}=await import(pathToFileURL(join(active,'src/qq-autonomy.mjs')));
  const [state,persona]=await Promise.all(['/api/state','/api/qq/personality'].map(p=>adminFetch('http://127.0.0.1:3789'+p).then(r=>r.json())));
  assert.equal(state.ai.qqReplyProvider,'gemini-3.8flash');
  const model=createGeminiRouterReply({timeoutMs:40000,maxTokens:1000});
  const cases=[
    {name:'retrieve-exchange-50-messages-back',question:'之前说星河剧场几点、在哪集合来着？',anchor:'周六星河剧场跑团，晚八点在东门集合。',expect:'facts'},
    {name:'summon-with-25-intervening-messages',question:'她呢？',anchor:'狐宫静刚刚还在这里和大家聊天',expect:'self',passive:true},
    {name:'old-bot-mention-is-not-the-new-girl',question:'她怎么还没回来呀？',anchor:'狐宫静刚才在群里聊天',expect:'silent',passive:true,lastHuman:'小林刚给小陈买奶茶去了，她才出门。'}
  ];
  report.cases=await Promise.all(cases.map(async(c,index)=>{
    let time=Date.now();const base={type:'group_message',groupId:'20012',selfId:'10015',senderId:'10014'};
    const options={now:()=>time,allowed:()=>true,getIdentity:()=>({names:['狐宫静','静静']}),management:{requests:()=>[]},sendPrivate:()=>assert.fail('No actual QQ writes')};
    const newer=await openQqAutonomy(join(dir,`new-${index}.json`),options),older=await openOld(join(dir,`old-${index}.json`),options);
    for(let i=0;i<120;i++){
      const text=i===(c.expect==='facts'?69:94)?c.anchor:i===118&&c.lastHuman?c.lastHuman:`闲聊第${i}条：哈哈，刚才那个梗好好笑`;
      const e={...base,senderId:i%2?'10018':'10014',raw:{message_id:1000+i},text};newer.observe(e);older.observe(e);time+=1000;
    }
    const source={...base,senderId:'10017',raw:{message_id:2000},text:c.question};
    const row={name:c.name,question:c.question,expected:c.expect,new:null,old:null};
    async function run(store,label){
      const e={...source,raw:{...source.raw}};store.observe(e);
      if(c.passive){e.proactiveDecision=store.candidate(e);if(!e.proactiveDecision)return {routed:false};}
      const protocol=store.prompt(e),prompt=buildCompactGeminiPrompt({instructions:persona.text,text:e.text})+'\n'+protocol;
      const started=performance.now(),raw=await model(prompt),reply=await store.consume(e,raw.text);
      return {routed:true,reply,durationMs:Math.round(performance.now()-started),promptChars:prompt.length,context:e.autonomyContextStats||{selected:8},rawPlan:raw.text,anchorVisible:protocol.includes(c.anchor),attention:store.snapshot().recentActions[0]?.attention};
    }
    // Sequential A/B requests within each independent case avoid comparing a
    // model response to a local-only timing. No retries or synthetic QQ events.
    try{
      row.old=await run(older,'old');row.new=await run(newer,'new');
      assert.equal(row.new.routed,true);assert.ok(row.new.context.selected<=16);assert.ok(row.new.context.chars<=2800);
      if(c.expect==='facts'){assert.ok(row.new.anchorVisible);assert.match(row.new.reply,/东门/);assert.match(row.new.reply,/八点|8.?点|20[:：]00/);}
      if(c.expect==='self')assert.ok(row.new.reply);
      if(c.expect==='silent')assert.equal(row.new.reply,'');
      row.pass=true;
    }catch(error){row.pass=false;row.error=error.message;}
    return row;
  }));
  const now=Date.now(),pool=Array.from({length:120},(_,i)=>({id:String(i),user:'10014',text:`星河剧场第${i}次跑团及周六东门集合方案`+'聊天内容'.repeat(35),at:now-(120-i)*1000}));
  const e={text:'周六跑团在哪集合',senderId:'10014',raw:{message_id:119}};
  selectQqContext(pool,e,{now});const times=[];for(let i=0;i<1000;i++){const t=performance.now();selectQqContext(pool,e,{now});times.push(performance.now()-t);}
  times.sort((a,b)=>a-b);report.localSelectionMs={samples:1000,median:times[500],p95:times[950],max:times.at(-1)};
  global.gc?.();const before=process.memoryUsage().heapUsed;
  const store=await openQqAutonomy(join(dir,'heap.json'),{allowed:()=>true});
  for(let g=0;g<64;g++)for(let i=0;i<120;i++)store.observe({type:'group_message',groupId:String(20013+g),senderId:'10014',selfId:'10015',text:`群${g}第${i}条：`+'独立内容'.repeat(46),raw:{message_id:g*120+i+1}});
  global.gc?.();report.synthetic64RoomHeapMiB=(process.memoryUsage().heapUsed-before)/1024/1024;
  assert.ok(report.cases.every(c=>c.pass));assert.ok(report.localSelectionMs.p95<20,'Local selection should not add noticeable latency');report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{await mkdir(join(root,'runtime/verification'),{recursive:true});const path=join(root,'runtime/verification','qq-context-budget-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...report,reportPath:path}));await rm(dir,{recursive:true,force:true});}
