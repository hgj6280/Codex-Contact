import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {retiredQqModel,LOCAL_TEXT_MODEL,isLocalTextProvider,isQqHttpTextProvider,createLocalModelReply,localRequestsExpert,LOCAL_EXPERT_MARKER} from './qq-local-model.mjs';

test('local text uses a fixed loopback endpoint, bounded generation and real local usage; dedicated local authorization, without cloud fallback',async()=>{
  let calls=0;
  const reply=createLocalModelReply({readKey:async()=>'fixture',fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,'http://127.0.0.1:18083/v1/chat/completions');assert.equal(init.redirect,'error');
    assert.equal(init.headers.authorization,'Bearer fixture');const body=JSON.parse(init.body);
    assert.equal(body.model,LOCAL_TEXT_MODEL);assert.equal(body.stream,false);assert.equal(body.max_tokens,1024);assert.equal(body.messages.at(-1).content,'原始上下文与当前提问');
    return Response.json({choices:[{message:{content:'本地回答'}}],usage:{prompt_tokens:20,completion_tokens:8}});
  }});
  const result=await reply('原始上下文与当前提问',{maxTokens:6144});assert.equal(result.model,LOCAL_TEXT_MODEL);assert.equal(result.text,'本地回答');assert.equal(result.local,true);assert.equal(result.usage.prompt_tokens,20);assert.equal(calls,1);
  for(const response of [Response.json({error:'offline'},{status:503}),Response.json({choices:[]})]){
    let n=0;await assert.rejects(createLocalModelReply({readKey:async()=>'fixture',fetchImpl:async()=>{n++;return response;}})('测试'));assert.equal(n,1);
  }
  await assert.rejects(reply(''),/不能为空/);
});
test('model selection persists local provider while keeping the original Codex image/model selection and rolling back failed saves',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('  if (req.method === "POST" && req.url === "/api/qq/model")'),end=source.indexOf('\n  if (req.method === "POST" && req.url === "/api/qq/groups")',start);
  const state={ai:{model:'gpt-6-luna',qqReplyProvider:'gemini-3.8flash',reasoningEffort:'low'}};
  const run=async(model,{local=true,fail=false}={})=>{
    let result;const sandbox={state,req:{method:'POST',url:'/api/qq/model'},res:{},GEMINI_ROUTER_MODEL:'gemini-3.8flash',retiredQqModel,isQqHttpTextProvider,isLocalChatRequest:()=>local,readBody:async()=>({model}),saveSettings:async()=>{if(fail)throw Error('disk');},sendJson:(_r,status,data)=>result={status,data}};
    await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',sandbox);return result;
  };
  assert.equal((await run(LOCAL_TEXT_MODEL)).status,200);assert.equal(state.ai.qqReplyProvider,LOCAL_TEXT_MODEL);assert.equal(state.ai.model,'gpt-6-luna');
  await assert.rejects(run('gpt-6-sol',{fail:true}),/disk/);assert.equal(state.ai.qqReplyProvider,LOCAL_TEXT_MODEL);assert.equal(state.ai.model,'gpt-6-luna');
  for(const model of ['gpt-6.1-sol','ag/gemini-3.8-flash'])assert.equal((await run(model)).status,400);
  assert.equal((await run('gemini-3.8flash')).status,400);
  assert.equal((await run('http://evil',{local:true})).status,400);assert.equal((await run('gpt-6-sol',{local:false})).status,403);
});

test('expert upgrades are exact protocol decisions, including action envelopes, not quoted mentions',()=>{
 assert.equal(localRequestsExpert(LOCAL_EXPERT_MARKER),true);
 assert.equal(localRequestsExpert(JSON.stringify({mode:'reply',reply:LOCAL_EXPERT_MARKER,actions:[]})),true);
 assert.equal(localRequestsExpert('用户提到 '+LOCAL_EXPERT_MARKER+' 这个词'),false);
 assert.equal(localRequestsExpert('{bad json'),false);
 assert.equal(localRequestsExpert(JSON.stringify({mode:'silence',reply:LOCAL_EXPERT_MARKER,actions:[]})),false);
 assert.equal(localRequestsExpert(JSON.stringify({mode:'reply',reply:LOCAL_EXPERT_MARKER,actions:[{type:'private'}]})),false);
});
