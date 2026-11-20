import {promptPart} from './qq-observability.mjs';
import {withUsageLedger} from './qq-usage.mjs';
import {normalizeStickerOutput} from './qq-sticker-output.mjs';
import {LOCAL_TEXT_MODEL,isLocalTextProvider,isQqHttpTextProvider,localRequestsExpert,repairLocalChatPlan} from './qq-local-model.mjs';
import {qqExplicitWebSearch,qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources,createQqWebLookup} from './qq-web-lookup.mjs';
import {protectQqModelIdentity} from './qq-model-identity.mjs';
import {finishQqVoiceReply} from './qq-voice-replies.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {useGeminiText,GEMINI_ROUTER_MODEL,isGeminiTextProvider,compactGeminiSoul,buildCompactGeminiPrompt} from './qq-text-context.mjs';
import {createGeminiRouterReply} from './qq-gemini-router.mjs';
import {QQ_PERSONALITY_SNAPSHOT} from './qq-personality.mjs';
import {limitQqReplyText,qqResponseIntent,QQ_LONG_REPLY_GUIDANCE} from './qq-reply-length.mjs';
import {QQ_DIALOGUE_GUIDANCE} from './qq-dialogue-context.mjs';

test('removed browser provider cannot route; current router never intercepts image jobs',()=>{
  assert.equal(isGeminiTextProvider('gemini-browser'),false);
  assert.equal(useGeminiText({provider:GEMINI_ROUTER_MODEL,imageRequested:false}),true);
  assert.equal(useGeminiText({provider:GEMINI_ROUTER_MODEL,imageRequested:true}),false);
  assert.equal(useGeminiText({provider:GEMINI_ROUTER_MODEL,imagePaths:['/ref.png']}),false);
  assert.equal(useGeminiText({provider:'codex-cli'}),false);
});
test('router is loopback-only, uses one bounded request, preserves real usage, and supports background JSON budget',async()=>{
  let calls=0,body;
  const base={readConfig:async()=>({models:{providers:{antigravity9router:{baseUrl:'http://127.0.0.1:20128/v1',apiKey:'test'}}}}),
    fetchImpl:async(url,init)=>{calls++;assert.equal(url,'http://127.0.0.1:20128/v1/chat/completions');assert.equal(init.redirect,'error');body=JSON.parse(init.body);return Response.json({choices:[{message:{content:'{"facts":[],"mood":null}'}}],usage:{prompt_tokens:30,completion_tokens:6}});}};
  const result=await createGeminiRouterReply({...base,analysis:true,maxTokens:850})('仅提取事实');
  assert.equal(calls,1);assert.equal(body.max_tokens,850);assert.equal(result.usage.prompt_tokens,30);assert.equal(result.usage.available,true);
  assert.match(body.messages[0].content,/JSON/);assert.doesNotMatch(body.messages[0].content,/仅回复 QQ/);
  await assert.rejects(createGeminiRouterReply({...base,readConfig:async()=>({models:{providers:{antigravity9router:{baseUrl:'https://foreign.test',apiKey:'test'}}}})})('a'),/不可用/);
  for(const response of [Response.json({error:{message:'quota'}},{status:429}),Response.json({choices:[{message:{content:''}}]})]){
    let n=0;await assert.rejects(createGeminiRouterReply({...base,fetchImpl:async()=>{n++;return response;}})('a'));assert.equal(n,1);
  }
});
test('compact prompt preserves current request, dedicated long-term recall, persona, privacy and Unicode',()=>{
  const text='不要遗漏当前要求。'.repeat(400),longTermContext='长期记忆：喜欢草莓，约好周六跑团。';
  const prompt=buildCompactGeminiPrompt({instructions:'不透露隐私。狐宫静',text,longTermContext,
    memoryContext:'旧事'.repeat(3000)+'最近一句',quotedContext:'引用内容',stickerCatalog:Array.from({length:500},(_,i)=>({name:`表情${i}.png`}))});
  assert.ok(prompt.includes(text));assert.ok(prompt.includes(longTermContext));assert.match(prompt,/最近一句/);assert.match(prompt,/引用内容/);
  assert.ok(prompt.length<text.length+1900);assert.equal(JSON.parse(prompt.match(/可用表情包：(\[.*?\])/)[1]).length,4);
  assert.ok(buildCompactGeminiPrompt({instructions:'规则',text:'🦊',longTermContext:'🦊'.repeat(3000)}).isWellFormed());
  assert.equal(compactGeminiSoul('# SOUL\n## 身份\n狐宫静\n## 语气示例\n长示例\n## 边界\n不泄露隐私'),'狐宫静\n不泄露隐私');
});
test('production text prompt includes retrieved evidence and mood; preview stays local, image tests retain the original route',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('async function buildModelReply(event)'),end=source.indexOf('function limitQqStickerFrequency',start);
  const prompts=[];
  const sandbox={
      promptPart,
      withUsageLedger,qqUsageLedger:{start:()=>({write(){},async finish(){}})},currentQqName:()=>'测试角色',normalizeStickerOutput,repairLocalChatPlan,localRequestsExpert,qqExplicitWebSearch,isQqHttpTextProvider,isLocalTextProvider,qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources,qqLife:null,qqResponseIntent,QQ_LONG_REPLY_GUIDANCE,QQ_DIALOGUE_GUIDANCE,protectQqModelIdentity,finishQqVoiceReply,readAloudText:()=>null,useGeminiText,GEMINI_ROUTER_MODEL,isGeminiTextProvider,buildCompactGeminiPrompt,QQ_PERSONALITY_SNAPSHOT,limitQqReplyText,
    event:{text:'还记得我喜欢什么吗？',type:'group_message'},
    state:{ai:{qqReplyProvider:GEMINI_ROUTER_MODEL,model:'gpt-6-luna'},qq:{enhancer:{enabled:false}}},
    stripMentionText:t=>t,isImageGenerationRequest:()=>false,getQqModelImageInputs:()=>[],hasAnyQqImageReference:()=>false,
    join:(...v)=>v.join('/'),crypto:{randomUUID:()=> 'id'},codexTmpDir:'/tmp',qqGeneratedArchiveDir:'/archive',dataDir:'/data',qqStickerDir:'/stickers',qqCharacterDir:'/oc',
    formatQuotedContext:()=> '引用内容',formatMemoryContext:()=> '近期聊天',formatQqPersonaContext:()=> '当前群画像',
    buildQqStickerCatalog:async()=>[],loadQqCharacter:async()=>({prompt:'OC',imagePaths:[]}),selectQqImageModel:()=> 'gpt-6-luna',
    buildAssistantInstructions:async()=> '我是狐宫静',formatQqStickerCatalog:()=>'',qqCompanion:{},
    safeCompanionContext:()=>({memory:'长期记忆：群友自述喜欢草莓',social:'互动风格弱参考：自然回复',recent:'刚聊过周末跑团'}),
    geminiRouterReply:async prompt=>{prompts.push(prompt);return {text:'你喜欢草莓呀',usage:{available:true},durationMs:1};},
    cleanCodexReply:t=>t,shouldRequestExpandedQqContext:()=>false,limitQqStickerFrequency:t=>t,
    ensureCodexReplyWorkspace:()=>assert.fail('No text CLI')};
  assert.equal(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),'你喜欢草莓呀');
  assert.match(prompts[0],/长期记忆：群友自述喜欢草莓/);assert.match(prompts[0],/周末跑团/);assert.match(prompts[0],/自然回复/);
  sandbox.state.ai.qqReplyProvider=LOCAL_TEXT_MODEL;
  sandbox.buildWebLookupContext=async()=>'';
  sandbox.localModelReply=async prompt=>{assert.match(prompt,/长期记忆：群友自述喜欢草莓/);return {text:'你喜欢草莓呀，本地也记得',model:LOCAL_TEXT_MODEL,usage:{available:true},durationMs:1};};
  sandbox.geminiRouterReply=async()=>assert.fail('Local reply must not call the cloud model');
  assert.equal(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),'你喜欢草莓呀，本地也记得');
  assert.equal(sandbox.event.replyModel,LOCAL_TEXT_MODEL);
  const previousEvent=sandbox.event;
  sandbox.state.ai.qqReplyProvider=GEMINI_ROUTER_MODEL;
  sandbox.event={...previousEvent,desktopDraft:true,localReplyProvider:LOCAL_TEXT_MODEL,text:'只写一句问候，不发图片'};
  sandbox.isImageGenerationRequest=()=>true;
  assert.equal(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),'你喜欢草莓呀，本地也记得');
  assert.equal(sandbox.event.replyModel,LOCAL_TEXT_MODEL);
  sandbox.event=previousEvent;sandbox.isImageGenerationRequest=()=>false;
  sandbox.state.ai.qqReplyProvider=LOCAL_TEXT_MODEL;
  let cloudCalls=0,localCalls=0;
  sandbox.ensureCodexReplyWorkspace=async()=>{cloudCalls++;throw Error('CLOUD_ROUTE_SELECTED');};
  sandbox.localModelReply=async()=>{localCalls++;return {text:'[[qq_expert]]',model:LOCAL_TEXT_MODEL,usage:{available:false}};};
  await assert.rejects(vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),/CLOUD_ROUTE_SELECTED/);
  assert.equal(localCalls,1);assert.equal(cloudCalls,1);
  sandbox.event={...previousEvent,text:'请联网搜索一下最新的官方技术规格'};
  await assert.rejects(vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),/CLOUD_ROUTE_SELECTED/);
  assert.equal(localCalls,1);assert.equal(cloudCalls,2);
  sandbox.event=previousEvent;
  sandbox.localModelReply=async()=>{throw Object.assign(Error('offline'),{status:503});};
  await assert.rejects(vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),/CLOUD_ROUTE_SELECTED/);
  assert.equal(cloudCalls,3);
  sandbox.localModelReply=async()=>{throw Object.assign(Error('busy'),{status:429});};
  await assert.rejects(vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),/busy/);
  assert.equal(cloudCalls,3);
  sandbox.state.ai.qqReplyProvider=GEMINI_ROUTER_MODEL;


  let calls=0;const queries=[];
  sandbox.safeCompanionContext=(_store,event)=>{
    queries.push(event.text);
    return {available:true,memory:event.text.includes('牛奶')?'查到的旧记忆：最喜欢草莓牛奶':'',social:'',recent:''};
  };
  sandbox.geminiRouterReply=async prompt=>({text:++calls===1?'[[qq_recall:饮品偏好 牛奶]]':(assert.match(prompt,/查到的旧记忆/),'你喜欢草莓牛奶'),usage:{available:true},durationMs:1});
  assert.equal(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),'你喜欢草莓牛奶');
  assert.equal(calls,2);assert.equal(queries.at(-1),'饮品偏好 牛奶');
  calls=0;sandbox.geminiRouterReply=async()=>{calls++;return {text:'[[qq_recall:还想再查]]',usage:{available:true},durationMs:1};};
  assert.match(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),/没有找到可靠的记忆/);assert.equal(calls,2);
  calls=0;sandbox.qqAutonomy={prompt:e=>{e.autonomyExpected=true;return '【QQ 自主动作协议】只输出JSON';},consume:async(_e,text)=>JSON.parse(text).reply};
  sandbox.geminiRouterReply=async prompt=>{calls++;assert.match(prompt,/QQ 自主动作协议/);return {text:'{"mode":"reply","reply":"自然接上这一句","actions":[]}',usage:{available:true},durationMs:1};};
  assert.equal(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),'自然接上这一句');assert.equal(calls,1);
  sandbox.geminiRouterReply=async()=>({text:'{"mode":"silence","reply":"","actions":[]}',usage:{available:true},durationMs:1});
  assert.equal(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),'');
  let searches=0,modelCalls=0,consumed=0;
  const lookup=createQqWebLookup({search:async()=>{searches++;return [{title:'官方当前技术规格',url:'https://www.apple.com.cn/mac-mini/specs/',snippet:'当前查证型号为示例设备P7，不能使用过时P1参数。'}];}});
  sandbox.qqLiveWebLookup=lookup;sandbox.buildWebLookupContext=e=>lookup.context(e,e.text);sandbox.state.qq.webLookup={enabled:true};sandbox.qqAutonomy={prompt:()=>''};
  sandbox.event={...sandbox.event,type:'group_at',selfId:'10011',groupId:'20011',text:'Mac mini 最新配置是什么？',autonomyExpected:false};
  sandbox.geminiRouterReply=async prompt=>{modelCalls++;assert.match(prompt,/示例设备P7/);return {text:'官网资料显示为示例设备P7。',usage:{available:true},durationMs:1};};
  assert.match(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),/https:\/\/www.apple.com.cn/);assert.equal(searches,1);assert.equal(modelCalls,1);
  sandbox.event={...sandbox.event,text:'这个新名词有资料吗？',webLookup:undefined};sandbox.qqAutonomy={prompt:e=>{e.autonomyExpected=true;return 'JSON协议，支持工具标记';},consume:async(_e,body)=>{consumed++;return JSON.parse(body).reply;}};
  modelCalls=0;sandbox.geminiRouterReply=async prompt=>({text:++modelCalls===1?JSON.stringify({mode:'reply',reply:'[[qq_search:示例设备 最新官方规格]]',actions:[]}):JSON.stringify({mode:'reply',reply:'查到了示例设备P7的资料。',actions:[]}),usage:{available:true},durationMs:1});
  assert.match(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox),/查到了示例设备P7/);assert.equal(modelCalls,2);assert.equal(consumed,1);assert.equal(searches,2);
});
test('lean local prompt keeps persona and identical evidence budgets while deduplicating protocol text',()=>{
 const args={instructions:'完整狐宫静人设：不可丢失的独特细节。',text:'当前要求',longTermContext:'长期记忆事实A',memoryContext:'近期原话B',quotedContext:'引用C',webContext:'实时来源D',desktopContext:[{text:'桌面E'}],allowRecall:true,stickerCatalog:[{name:'开心.webp'}]};
 const normal=buildCompactGeminiPrompt(args),lean=buildCompactGeminiPrompt({...args,localCompact:true,protocolManaged:true});
 for(const text of ['不可丢失的独特细节','长期记忆事实A','近期原话B','引用C','实时来源D','桌面E','当前要求'])assert.ok(lean.includes(text));
 assert.ok(lean.length<normal.length);assert.ok(lean.endsWith('当前要求'));
});
