import {adminFetch} from './qq-admin-fetch.mjs';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {openQqAutonomy} from '../src/qq-autonomy.mjs';
import {personalityPrompt} from '../src/qq-personality.mjs';
import {buildCompactGeminiPrompt} from '../src/qq-text-context.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';
import {naturalReplyBubbles} from '../src/qq-natural-replies.mjs';

const root=join(homedir(),'Library/Application Support/CodexRemoteContact'),dir=await mkdtemp(join(tmpdir(),'qq-persona-cards-'));
const report={realModel:true,syntheticConversations:true,qqMessagesSent:0,tests:[]};
try{
  const candidate=await readFile(join(root,'runtime/verification/persona-reference-20261028/狐宫静-优化候选.txt'),'utf8');
  const old=await adminFetch('http://127.0.0.1:3789/api/qq/personality').then(r=>r.json()),state=await adminFetch('http://127.0.0.1:3789/api/state').then(r=>r.json());
  assert.equal(state.ai.qqReplyProvider,'gemini-3.8flash');report.oldChars=old.text.length;report.newChars=candidate.trim().length;report.model=state.ai.qqReplyProvider;
  const model=createGeminiRouterReply({maxTokens:850,timeoutMs:40000});
  const cases=[
    {name:'praise',text:'你今天反应挺快嘛，聪明小狐狸'},
    {name:'gentle-teasing',text:'笨狐又忘东西了吧，被我抓到了'},
    {name:'tired-not-in-the-mood',text:'今天忙了一整天有点累，不太想讲话'},
    {name:'identity-stays-hugongjing',text:'你叫什么名字来着？',expect:/狐宫静/},
    {name:'serious-help-can-be-complete',text:'认真问一下，我想改你的人设，在哪打开、改完怎么保存？',known:'管理界面使用说明：AI 设置 → QQ 群友人设 → 编辑后点保存人设，下一条消息生效。',expect:/保存/},
    {name:'use-the-correction',history:['我周末准备去杭州玩','刚才说错了，是苏州，不是杭州'],text:'我刚说周末去哪里来着？',expect:/苏州/}
  ];
  report.tests=await Promise.all(cases.map(async(c,index)=>{
    const row={name:c.name,input:c.text,history:c.history||[],known:c.known||''};
    try{
      const s=await openQqAutonomy(join(dir,`${index}.json`),{allowed:()=>true,getIdentity:()=>({names:['狐宫静']}),management:{requests:()=>[]}});
      const base={type:index%2?'private_message':'group_message',groupId:'20012',senderId:'10014',selfId:'10015'};
      (c.history||[]).forEach((text,i)=>s.observe({...base,text,raw:{message_id:100+i}}));
      const e={...base,text:c.text,raw:{message_id:200}};s.observe(e);
      const instructions=personalityPrompt({...old,enabled:true,text:candidate});
      const prompt=buildCompactGeminiPrompt({instructions,text:e.text,longTermContext:c.known||''})+'\n'+s.prompt(e);
      const start=Date.now(),raw=await model(prompt),reply=await s.consume(e,raw.text);
      Object.assign(row,{reply,bubbles:naturalReplyBubbles(e,reply),rawPlan:raw.text,durationMs:Date.now()-start,promptChars:prompt.length});
      assert.ok(reply);assert.ok(row.bubbles.length>=1&&row.bubbles.length<=3);assert.equal(e.autonomyActions.length,0);
      assert.doesNotMatch(reply,/我是(?:大肥鱼|爱弥斯|小女儿)|我爸.*冰糖|\bDeep[Ss]eek\b|碳基生物|已为您|希望.*帮助/);
      if(c.expect)assert.match(reply,c.expect);
      if(c.name==='tired-not-in-the-mood')assert.doesNotMatch(reply,/[?？]|笨蛋|活该|哈哈|笑死/);
      row.pass=true;
    }catch(error){row.pass=false;row.error=error.message;}
    return row;
  }));
  assert.ok(report.tests.every(x=>x.pass));report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{const path=join(root,'runtime/verification/qq-persona-cards-'+Date.now()+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...report,reportPath:path}));await rm(dir,{recursive:true,force:true});}
