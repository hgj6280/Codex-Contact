import {adminFetch} from './qq-admin-fetch.mjs';
import {mkdtemp,rm,mkdir,writeFile,readdir} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {openQqAutonomy} from '../src/qq-autonomy.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';
import {buildCompactGeminiPrompt} from '../src/qq-text-context.mjs';
import {sendNaturalReply} from '../src/qq-natural-replies.mjs';
import {stickerCatalog,resolveImages} from '../src/qq-media.mjs';

const dir=await mkdtemp(join(tmpdir(),'qq-daily-chat-'));
const report={startedAt:new Date().toISOString(),realModel:true,syntheticConversations:true,explicitBatchTest:false,qqMessagesSent:0,steps:[]};
let time=Date.now();
try{
  const profile=await adminFetch('http://127.0.0.1:3789/api/qq/personality').then(r=>r.json());
  const store=await openQqAutonomy(join(dir,'state.json'),{now:()=>time,allowed:()=>true,management:{requests:()=>[]},sendPrivate:()=>assert.fail('No actual QQ sends')});
  const model=createGeminiRouterReply({timeoutMs:40000,maxTokens:800});
  const base={type:'group_message',groupId:'20012',senderId:'10014',selfId:'10015'};
  async function ask(e){
    store.observe(e);
    if(e.unmentioned){e.proactiveDecision=store.candidate(e);assert.ok(e.proactiveDecision,'Ordinary followup must qualify');}
    const prompt=buildCompactGeminiPrompt({instructions:profile.text,text:e.text})+'\n'+store.prompt(e);
    assert.ok(!prompt.includes('operator-batch:'));
    const started=Date.now(),raw=await model(prompt),reply=await store.consume(e,raw.text),sent=[];
    assert.equal(e.autonomyActions.length,0);assert.ok(reply);
    const transport=await sendNaturalReply({event:e,reply,canContinue:i=>store.canContinue(e,{first:i===0}),send:async(text,options)=>{sent.push({text,quote:options.quoteSource});return {ok:true};}});
    assert.equal(transport.ok,true);assert.ok(sent.length>=1&&sent.length<=3);
    assert.ok(!/抱着尾巴|泡了.*茶|泡了.*可可|调整.*节奏|测试一下/.test(reply),reply);
    report.steps.push({type:e.type,request:e.text,unmentioned:!!e.unmentioned,reply,bubbles:sent,rawPlan:raw.text,durationMs:Date.now()-started});
    await store.delivered(e,{reply});time+=7000;
  }
  await ask({...base,raw:{message_id:1001},text:'周六第一次去跑团，角色卡写好了，但怕紧张忘词。你觉得我该准备点什么？'});
  await ask({...base,raw:{message_id:1002},unmentioned:true,text:'这样听起来没那么可怕了，但要是卡住冷场还是会很尴尬。'});
  await ask({...base,type:'private_message',raw:{message_id:1003},text:'今天忙了一整天总算下班了，想打游戏又有点困，不知道要不要开一把。'});
  assert.ok(report.steps.some(s=>s.bubbles.length>1),'At least one ordinary model reply should naturally contain multiple bubbles');
  const stickerDir=join(homedir(),'Library/Application Support/CodexRemoteContact/data/qq-stickers');
  assert.ok(!(await stickerCatalog(stickerDir)).some(s=>s.name==='偷偷探头.webp'||s.name==='oc-117.webp'));
  assert.deepEqual(await resolveImages('文字照常发\n[[qq_sticker:偷偷探头.webp]]',{stickerDir}),[]);
  const alias=(await readdir(stickerDir,{recursive:true})).find(name=>name.endsWith('oc-117.webp'));assert.ok(alias);
  assert.deepEqual(await resolveImages(`[[qq_image:${join(stickerDir,alias)}]]`,{stickerDir}),[]);
  report.stickerPolicy={disabledAliases:['偷偷探头.webp','oc-117.webp'],catalogHidden:true,staleMarkerSkipped:true,directPathBlocked:true};report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{
  const out=join(homedir(),'Library/Application Support/CodexRemoteContact/runtime/verification');await mkdir(out,{recursive:true});
  const path=join(out,'qq-daily-chat-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({...report,reportPath:path}));await rm(dir,{recursive:true,force:true});
}
