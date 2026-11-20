import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDesktopDrafts} from './qq-desktop-drafts.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const input=(conversationId='20010')=>({conversationId,request:'帮写一句问候',requestId:randomUUID()});
test('AI draft completes as a preview, reuses its task id and rejects conflicting retries',async()=>{
  let calls=0;const queue=createDesktopDrafts({validate:id=>assert.equal(id,'20010'),generate:async()=>{calls++;return {text:'你好',images:[]};}});
  const request=input();const initial=await queue.start(request);assert.equal(initial.status,'running');
  await tick();assert.equal(queue.get(initial.id).status,'completed');assert.equal(queue.get(initial.id).result.text,'你好');
  await queue.start(request);assert.equal(calls,1);assert.equal(queue.active(),0);
  await assert.rejects(queue.start({...request,request:'other'}),/编号/);
  const copy=queue.get(initial.id);copy.result.text='changed';assert.equal(queue.get(initial.id).result.text,'你好');
});
test('AI queue bounds global/conversation concurrency without sending anything',async()=>{
  const release=[];const queue=createDesktopDrafts({validate:()=>{},generate:()=>new Promise(resolve=>release.push(resolve))});
  await queue.start(input());await queue.start(input('20015'));assert.equal(queue.active(),2);
  await assert.rejects(queue.start(input('20014')),/其他 AI/);
  await tick();release.forEach(resolve=>resolve({text:'draft'}));await tick();assert.equal(queue.active(),0);
  const waiting=createDesktopDrafts({validate:()=>{},generate:()=>new Promise(()=>{})});await waiting.start(input());
  await assert.rejects(waiting.start(input()),/当前会话/);
});
test('permission changes are rechecked, failures are explicit and finished previews expire',async()=>{
  let allowed=true,time=0;const queue=createDesktopDrafts({now:()=>time,validate:()=>{if(!allowed)throw new Error('未授权');},generate:async()=>{throw new Error('图片验收失败：左手动作');}});
  const request=input();await queue.start(request);await tick();assert.equal(queue.get(request.requestId).status,'failed');
  assert.match(queue.get(request.requestId).error,/左手动作/);assert.equal(queue.active(),0);
  allowed=false;await assert.rejects(queue.start(request),/未授权/);time=3600001;assert.equal(queue.get(request.requestId),null);
  await assert.rejects(queue.start({...request,request:''}),/1–4000/);
});

test('local-only preview captures its provider without mutating the global model or reusing another provider request',async()=>{
  let captured;const queue=createDesktopDrafts({validate:()=>{},generate:async payload=>{captured=payload;return {text:'local preview'};}});
  const request={...input(),localModel:true};await queue.start(request);await tick();assert.equal(captured.localModel,true);
  await assert.rejects(queue.start({...request,localModel:false}),/编号/);
  await assert.rejects(queue.start({...input(),localModel:'http://elsewhere'}),/参数无效/);
});
