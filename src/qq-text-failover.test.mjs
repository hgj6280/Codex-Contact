import test from 'node:test';
import assert from 'node:assert/strict';
import {createQqTextFailover} from './qq-text-failover.mjs';
import {createGeminiRouterReply} from './qq-gemini-router.mjs';

test('HTTP 200 empty Gemini output uses backup, then a later request recovers to Gemini',async()=>{
  let time=0,calls=0,backups=0;
  const primary=createGeminiRouterReply({
    readConfig:async()=>({models:{providers:{antigravity9router:{baseUrl:'http://127.0.0.1:20128/v1',apiKey:'test'}}}}),
    fetchImpl:async()=>Response.json({choices:[{message:{content:++calls===1?'':'恢复正常'}}]})
  });
  const route=createQqTextFailover({primary,now:()=>time,cooldownMs:100,fallback:async prompt=>{backups++;return {text:prompt};}});
  const first=await route.reply('当前消息');assert.equal(first.text,'当前消息');assert.equal(first.model,'gpt-6-luna');
  assert.match(first.fallback.reason,/空白或无效/);
  await route.reply('下一条');assert.equal(calls,1);assert.equal(backups,2);
  time=101;assert.equal((await route.reply('恢复检查')).text,'恢复正常');assert.equal(route.snapshot().degraded,false);
});

test('Node fetch network causes trip backup without retrying, while content blocks stay visible',async()=>{
  for(const code of ['ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET']){
    let backups=0;
    const route=createQqTextFailover({primary:async()=>{throw new TypeError('fetch failed',{cause:{code}});},fallback:async()=>{backups++;return {text:'接管成功'};}});
    assert.equal((await route.reply('a')).text,'接管成功');assert.equal(backups,1);
  }
  let backups=0;
  const primary=createGeminiRouterReply({readConfig:async()=>({models:{providers:{antigravity9router:{baseUrl:'http://127.0.0.1:20128/v1',apiKey:'test'}}}}),fetchImpl:async()=>Response.json({choices:[{message:{content:''},finish_reason:'content_filter'}]})});
  await assert.rejects(createQqTextFailover({primary,fallback:async()=>{backups++;}}).reply('a'),{code:'GEMINI_CONTENT_BLOCKED'});assert.equal(backups,0);
});
test('upstream 503 uses Luna, skips failed route during cooldown, then recovers without changing model settings',async()=>{
  let time=1000,primaryCalls=0,fallbackCalls=0,recovered=false;
  const route=createQqTextFailover({now:()=>time,cooldownMs:100,primary:async()=>{primaryCalls++;if(!recovered)throw Object.assign(Error('upstream'),{status:503});return {text:'Gemini正常',model:'gemini-3.8flash'};},fallback:async prompt=>{fallbackCalls++;return {text:prompt,usage:{available:false}};}});
  const a=await route.reply('你好');assert.equal(a.model,'gpt-6-luna');assert.equal(a.text,'你好');assert.equal(route.snapshot().degraded,true);
  await route.reply('接着聊');assert.equal(primaryCalls,1);assert.equal(fallbackCalls,2);
  time+=101;recovered=true;assert.equal((await route.reply('恢复了吗')).model,'gemini-3.8flash');assert.equal(route.snapshot().degraded,false);
  route.noteUnavailable(Object.assign(Error('503'),{status:503}));assert.equal(route.snapshot().canTryPrimary,false);time+=101;assert.equal(route.snapshot().canTryPrimary,true);route.noteAvailable();assert.equal(route.snapshot().degraded,false);
});
test('authentication/configuration errors are visible, and failed fallback is never blindly retried',async()=>{
  for(const status of [401,403]){let backups=0;const route=createQqTextFailover({primary:async()=>{throw Object.assign(Error('auth'),{status});},fallback:async()=>{backups++;}});await assert.rejects(route.reply('test'),/auth/);assert.equal(backups,0);assert.equal(route.snapshot().degraded,false);}
  let calls=0;const route=createQqTextFailover({primary:async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});},fallback:async()=>{calls++;throw Error('Luna also unavailable');}});await assert.rejects(route.reply('test'),/Luna also unavailable/);assert.equal(calls,1);
});
test('background failure trips the same health guard; a recovery probe is shared without sharing user replies',async()=>{
  let time=0,release,calls=0;const route=createQqTextFailover({now:()=>time,cooldownMs:100,primary:()=>{calls++;return new Promise(r=>release=r);},fallback:async prompt=>({text:prompt})});
  assert.equal(route.noteUnavailable(Object.assign(Error('TLS reset'),{code:'ECONNRESET'})),true);assert.equal((await route.reply('one')).text,'one');
  time=101;const probe=route.reply('probe');const next=await route.reply('two');assert.equal(next.text,'two');assert.equal(calls,1);release({text:'recovered',model:'gemini-3.8flash'});await probe;assert.equal(route.snapshot().degraded,false);
});
