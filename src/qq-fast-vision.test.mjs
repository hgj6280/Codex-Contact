import {promptPart} from './qq-observability.mjs';
import {isLocalTextProvider,isQqHttpTextProvider} from './qq-local-model.mjs';
import {qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources} from './qq-web-lookup.mjs';
import {protectQqModelIdentity} from './qq-model-identity.mjs';
import {finishQqVoiceReply} from './qq-voice-replies.mjs';
import {qqResponseIntent,QQ_LONG_REPLY_GUIDANCE} from './qq-reply-length.mjs';
import {QQ_DIALOGUE_GUIDANCE} from './qq-dialogue-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createVisionImageCache,runFastVisionReply,QQ_VISION_MODEL} from './qq-fast-vision.mjs';
import {buildCompactGeminiPrompt,useGeminiText,isGeminiTextProvider,GEMINI_ROUTER_MODEL} from './qq-text-context.mjs';

test('ordinary vision runs exactly one Luna call with current pixels, low reasoning, no image generation or identity references',async()=>{
  let calls=0;const r=await runFastVisionReply({paths:['/current.png','/quote.png','/current.png'],outputPath:'/out',cwd:'/work',instructions:'我是狐宫静',text:'[CQ:image,url=secret]图上写的什么',context:{memory:'本会话记忆'},autonomyPrompt:'自主协议',
    run:async(args,prompt,options)=>{calls++;assert.equal(args[args.indexOf('-m')+1],'gpt-6-luna');assert.ok(args.includes('model_reasoning_effort="low"'));assert.equal(args.filter(a=>a==='--image').length,2);assert.equal(args[args.indexOf('--disable')+1],'image_generation');assert.ok(!args.some(a=>a==='service_tier="fast"'));assert.equal(options.captureImages,false);assert.equal(options.timeout,45000);assert.match(prompt,/当前图片事实优先/);assert.match(prompt,/本会话记忆/);assert.doesNotMatch(prompt,/url=secret/);},read:async()=>'图上写着给您退单'});
  assert.equal(calls,1);assert.equal(r.model,QQ_VISION_MODEL);assert.equal(r.passes,1);assert.match(r.text,/给您退单/);
});
test('image cache deduplicates concurrent quotes, bounds image download concurrency, retries failures, and expires',async()=>{
  let now=1,calls=0,active=0,maximum=0,fail=false;const cache=createVisionImageCache({now:()=>now,ttlMs:100,exists:async()=>true,prepare:async images=>{
    calls++;active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,3));active--;return fail?[]:['/'+images[0].file+'.png'];
  }});
  const input=[{file:'1',url:'https://gchat.qpic.cn/one'}],options={outputDir:'/incoming'};
  await Promise.all([cache.prepare(input,options),cache.prepare(input,options)]);assert.equal(calls,1);assert.equal(cache.snapshot().hits,1);
  now=200;await cache.prepare(input,options);assert.equal(calls,2);
  await cache.prepare([{file:'2'},{file:'3'},{file:'4'}],options);assert.ok(maximum<=2);
  fail=true;await cache.prepare([{file:'5'}],options);const before=calls;fail=false;await cache.prepare([{file:'5'}],options);assert.equal(calls,before+1);
});
test('production image reply skips independent pre-reading, OC files and web lookup; only local preview is generated',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8'),start=source.indexOf('async function buildModelReply(event)'),end=source.indexOf('function limitQqStickerFrequency',start);
  let calls=0;
  const context={
      promptPart,
      currentQqName:()=>'测试角色',isLocalTextProvider,isQqHttpTextProvider,qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources,qqResponseIntent,QQ_LONG_REPLY_GUIDANCE,QQ_DIALOGUE_GUIDANCE,qqLife:null,protectQqModelIdentity,finishQqVoiceReply,readAloudText:()=>null,event:{type:'private_message',text:'看看这张图',images:[{file:'qq-image'}]},state:{ai:{qqReplyProvider:'gemini-3.8flash',model:'gpt-6.1-sol',qqImageValidation:false,qqFastMode:false},qq:{enhancer:{enabled:false}}},
    QQ_VISION_MODEL,runFastVisionReply:async input=>{calls++;assert.deepEqual(Array.from(input.paths),['/current.png']);return {text:'当前图里的狐狸在托腮',model:QQ_VISION_MODEL,passes:1,durationMs:10,promptChars:800};},qqVisionImages:{prepare:async()=>['/current.png'],snapshot:()=>({hits:1})},
    stripMentionText:t=>t,isImageGenerationRequest:()=>false,getQqModelImageInputs:e=>e.images,hasAnyQqImageReference:()=>true,formatQuotedContext:()=>'',formatMemoryContext:()=>'',formatQqPersonaContext:()=>'',
    dataDir:'/data',codexTmpDir:'/tmp',codexWorkspaceDir:'/work',qqCharacterDir:'/oc',qqStickerDir:'/stickers',qqGeneratedArchiveDir:'/archive',localCodexPaths:{incomingImages:'/incoming'},fetchOneBotImage:async()=>{},
    join:(...p)=>p.join('/'),crypto:{randomUUID:()=> 'id'},process:{env:{}},isGeminiTextProvider,GEMINI_ROUTER_MODEL,useGeminiText,buildCompactGeminiPrompt,
    buildWebLookupContext:()=>assert.fail('no speculative web'),loadQqCharacter:()=>assert.fail('no OC loading for ordinary vision'),buildQqStickerCatalog:async()=>[],selectQqImageModel:m=>m,
    ensureCodexReplyWorkspace:async()=>{},buildAssistantInstructions:async()=> '狐宫静',runCodexCli:()=>assert.fail('separate old CLI must not run'),cleanCodexReply:t=>t,limitQqReplyText:t=>t,limitQqStickerFrequency:t=>t};
  const result=await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',context);assert.match(result,/托腮/);assert.equal(calls,1);assert.equal(context.event.replyModel,'gpt-6-luna');assert.equal(context.event.characterReferenceCount,0);
  context.event={...context.event,desktopDraft:true,images:[{url:'/api/qq/chat/image/'+'a'.repeat(64)}]};
  context.qqChat={remoteMedia:async key=>{assert.equal(key,'a'.repeat(64));return {bytes:Buffer.from('verified bytes')};}};
  context.prepareImages=async(images,options)=>{assert.equal((await options.download()).toString(),'verified bytes');return ['/current.png'];};
  assert.match(await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',context),/托腮/);assert.equal(calls,2);
});
