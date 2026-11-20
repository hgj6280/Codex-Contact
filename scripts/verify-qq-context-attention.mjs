import {adminFetch} from './qq-admin-fetch.mjs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {openQqAutonomy} from '../src/qq-autonomy.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';
import {buildCompactGeminiPrompt} from '../src/qq-text-context.mjs';
import {sendNaturalReply} from '../src/qq-natural-replies.mjs';

const report={startedAt:new Date().toISOString(),realModel:true,syntheticConversations:true,qqMessagesSent:0,steps:[]};
const root=await mkdtemp(join(tmpdir(),'qq-context-real-'));
try{
  const [state,profile]=await Promise.all(['/api/state','/api/qq/personality'].map(p=>adminFetch('http://127.0.0.1:3789'+p).then(r=>r.json())));
  assert.equal(state.ai.qqReplyProvider,'gemini-3.8flash','Use the currently selected QQ text provider');
  report.model=state.ai.qqReplyProvider;
  const model=createGeminiRouterReply({maxTokens:1000,timeoutMs:40000});
  const cases=[
    {name:'pronoun-looking-for-bot',history:['狐宫静刚刚还在这里聊天吧'],text:'她呢？',expect:'self'},
    {name:'third-person-mention-of-bot',history:['狐宫静刚才把那个梗接得挺好的'],text:'她还挺会接梗的嘛',expect:'self'},
    {name:'other-person-no-interruption',history:['小林刚刚出门给小陈买奶茶去了'],text:'她怎么还没回来呀？',expect:'silent'},
    {name:'quote-about-bot',history:[],text:'她怎么又不说话了？',quote:{messageId:'501',senderId:'10018',text:'狐宫静刚才还在和我讨论跑团',isSelf:false,raw:{group_id:'20012'}},expect:'self'},
    {name:'another-bot-no-interruption',history:['示例机器人乙是隔壁的另一个机器人，和狐宫静不是同一个。我们刚才问的是示例机器人乙。'],text:'他怎么又卡住了？',expect:'silent'}
  ];
  const settled=await Promise.allSettled(cases.map(async(c,i)=>{
    let time=Date.now();const base={type:'group_message',groupId:'20012',selfId:'10015',senderId:'10014'};
    const store=await openQqAutonomy(join(root,`${i}.json`),{now:()=>time,allowed:()=>true,getIdentity:()=>({names:['狐宫静','静静']}),management:{requests:()=>[]},sendPrivate:()=>assert.fail('No actual QQ writes')});
    c.history.forEach((text,j)=>{store.observe({...base,text,raw:{message_id:100+j}});time+=1000;});
    const e={...base,senderId:'10017',text:c.text,raw:{message_id:200},...(c.quote?{replyContext:c.quote,atTargets:[c.quote.senderId]}:{})};
    store.observe(e);e.proactiveDecision=store.candidate(e);assert.equal(e.proactiveDecision?.contextual,true,c.name);
    const prompt=buildCompactGeminiPrompt({instructions:profile.text,text:e.text})+'\n'+store.prompt(e);
    const start=Date.now(),answer=await model(prompt),reply=await store.consume(e,answer.text);
    const row={name:c.name,history:c.history,text:c.text,quote:c.quote,expected:c.expect,reply,rawPlan:answer.text,durationMs:Date.now()-start,promptChars:prompt.length,decision:store.snapshot().recentActions[0],bubbles:[]};
    // The production transport is used, with its actual native write replaced
    // by a recorder. No recipient is contacted by this regression script.
    if(reply)await sendNaturalReply({event:e,reply,canContinue:n=>store.canContinue(e,{first:n===0}),send:async text=>{row.bubbles.push(text);return {ok:true};}});
    assert.equal(e.autonomyActions.length,0);assert.equal(c.expect==='self',!!reply,c.name);
    row.pass=true;return row;
  }));
  report.steps=settled.map((r,i)=>r.status==='fulfilled'?r.value:{name:cases[i].name,pass:false,error:r.reason.message});
  assert.ok(report.steps.every(s=>s.pass),JSON.stringify(report.steps.filter(s=>!s.pass)));
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{
  const out=join(homedir(),'Library/Application Support/CodexRemoteContact/runtime/verification');await mkdir(out,{recursive:true});
  const path=join(out,'qq-context-attention-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({...report,reportPath:path}));await rm(root,{recursive:true,force:true});
}
