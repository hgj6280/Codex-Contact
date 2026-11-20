// Real configured reply model; synthetic people, isolated state, no QQ sender.
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {openQqAutonomy} from '../src/qq-autonomy.mjs';
import {personalityPrompt} from '../src/qq-personality.mjs';
import {createGeminiRouterReply} from '../src/qq-gemini-router.mjs';
import {openUsageLedger} from '../src/qq-usage.mjs';

const root=join(homedir(),'Library/Application Support/CodexRemoteContact');
const dir=await mkdtemp(join(tmpdir(),'qq-social-rhythm-'));
const profile=JSON.parse(await readFile(join(root,'data/qq-personality.json'),'utf8'));
const model=createGeminiRouterReply({analysis:true,maxTokens:600,timeoutMs:40000});
const usage=await openUsageLedger(join(root,'data/qq-token-usage'));
const report={reference:'https://github.com/Mieksido/surfcore',qqMessagesSent:0,syntheticConversations:true,tests:[]};
try{
  for(const [i,c] of [
    {name:'finished-thread',text:'事情已经解决了，今天先聊到这里，我想休息了，下次再聊。',closure:true,at:'2026-10-29T12:00:00Z'},
    {name:'called-at-night',text:'狐宫静，还在吗？只跟我打个招呼就好。',at:'2026-10-29T18:00:00Z'}
  ].entries()){
    const store=await openQqAutonomy(join(dir,i+'.json'),{now:()=>Date.parse(c.at),allowed:()=>true,getIdentity:()=>({names:['狐宫静']}),management:{requests:()=>[]}});
    const event={type:'group_message',groupId:'20012',senderId:'10014',selfId:'10015',text:c.text,hasSelfAtSegment:true,raw:{message_id:i+1}};
    store.observe(event);
    const tracker=usage.start('ag/gemini-3.8-flash');
    try{
      const result=await model(personalityPrompt(profile)+'\n'+store.prompt(event)+'\n本轮真实消息（测试资料）：'+JSON.stringify(c.text));
      if(result.usage?.available)tracker.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:result.usage.prompt_tokens,output_tokens:result.usage.completion_tokens,cached_input_tokens:result.usage.prompt_tokens_details?.cached_tokens||0}})+'\n');
      const reply=await store.consume(event,result.text);
      assert.ok(reply.trim());assert.equal(event.autonomyActions.length,0);
      if(c.closure){assert.equal(event.autonomyCloseThread,true);assert.doesNotMatch(reply,/[?？]/);}
      assert.doesNotMatch(reply,/刚睡醒|刚喝完|刚看完视频|我有自主意识|主观意识/);
      report.tests.push({name:c.name,pass:true,reply,closeThread:event.autonomyCloseThread,durationMs:result.durationMs});
      await tracker.finish('completed');
    }catch(error){await tracker.finish('failed');throw error;}
  }
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{
  const output=join(root,'runtime/verification/qq-social-rhythm-'+Date.now()+'.json');
  await mkdir(join(root,'runtime/verification'),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({...report,output}));
  await rm(dir,{recursive:true,force:true});
}
