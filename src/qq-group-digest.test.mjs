import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openGroupDigest,parseGroupDigest,finishDigestText} from './qq-group-digest.mjs';
const g='20011',u='10012';
const event=(text,id='1')=>({type:'group_message',groupId:g,senderId:u,selfId:'10011',text,messageId:id});
async function fixture(t,opts={}){const dir=await mkdtemp(join(tmpdir(),'qq-digest-'));const prompts=[],sends=[];const options={summarize:async p=>{prompts.push(p);return {text:'10012说“我喜欢草莓” [m1]'};},send:async(e,text)=>{sends.push({e,text});return {ok:true};},isAdmin:e=>e.senderId===u,...opts};let store=await openGroupDigest(dir,options);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {prompts,sends,get store(){return store;},async reopen(){store.close();store=await openGroupDigest(dir,options);}};}
function row(group=g,id='m1',sender=u){return {groupId:group,messageId:id,senderId:sender,senderName:'小明',text:'我喜欢草莓',at:new Date().toISOString(),direction:'incoming'};}
async function finish(store){for(let i=0;i<100&& (store.snapshot().active||store.snapshot().queued);i++)await new Promise(r=>setTimeout(r,5));assert.equal(store.snapshot().active,false);}
test('duration, selected members and non-commands parse without triggering normal chat',()=>{
 assert.equal(parseGroupDigest('总结最近2小时群聊').hours,2);assert.equal(parseGroupDigest('/群总结 最近30分钟').hours,.5);assert.equal(parseGroupDigest('/群总结 最近31天').action,'help');assert.equal(parseGroupDigest('我刚才说过群总结是什么意思吗'),null);
 assert.equal(parseGroupDigest('/群总结 取消关注 10012').action,'untrack');assert.deepEqual(parseGroupDigest('/群总结 群友 10012 最近7天').users,[u]);
});
test('real archive to queued model summary to original group; duplicates, profile recall, restart and untrack',async t=>{
 const f=await fixture(t);f.store.observe(row());f.store.observe(row());f.store.observe({...row('20010','secret'),text:'其他群秘密'});f.store.observe({...row(g,'private'),groupId:'private:'+u,text:'私人秘密'});
 assert.match((await f.store.handle(event('/群总结 关注 '+u))).reply,/已保存/);
 const task=await f.store.handle(event('/群总结 群友 '+u+' 最近2小时','2'));assert.equal(f.prompts.length,0);assert.ok(task.afterSend);await task.afterSend();await finish(f.store);
 assert.equal(f.sends.length,1);assert.equal(f.sends[0].e.groupId,g);assert.match(f.sends[0].text,/1\/1条/);assert.match(f.prompts[0],/我喜欢草莓/);assert.doesNotMatch(f.prompts[0],/其他群秘密|私人秘密/);
 assert.equal((await f.store.handle(event('/群总结 群友 '+u,'2'))).reply,null);await f.reopen();assert.match(f.store.context(event('你好')),/草莓/);assert.equal(f.store.context({...event('你好'),groupId:'20010'}),'');
 await f.store.handle(event('/群总结 取消关注 '+u,'3'));assert.equal(f.store.context(event('你好')),'');
});
test('unauthorized settings, absent history, disabled send and failed delivery are truthful',async t=>{
 const f=await fixture(t,{send:async()=>({ok:false})});assert.match((await f.store.handle({...event('/群总结 关注 123456'),senderId:'10019'})).reply,/管理员/);
 let task=await f.store.handle(event('/群总结 最近1小时','4'));await task.afterSend();await finish(f.store);assert.equal(f.prompts.length,0);
 const res=await f.store.handle(event('/群总结 结果','5'));assert.match(res.reply,/没有已接收/);
 f.store.observe(row());task=await f.store.handle(event('/群总结','6'));await task.afterSend();await finish(f.store);assert.match((await f.store.handle(event('/群总结 结果','7'))).reply,/草莓/);
});

test('automatic daily archive is group opt-in, persistent, deduped and does not send when archive-only',async t=>{
 let clock=Date.parse('2026-11-08T12:00:00Z');const f=await fixture(t,{now:()=>clock,autoTimer:false,getAutomaticEvent:group=>({...event(''),groupId:group})});
 f.store.settings(g,{auto:{enabled:true,hour:21,sendToGroup:false}});const next=f.store.config(g).auto.nextAt;assert.equal(next,Date.parse('2026-11-08T13:00:00Z'));assert.equal(f.store.config('20010').auto.enabled,false);
 f.store.observe({...row(),at:new Date(clock).toISOString()});clock=next;await f.store.tick();await finish(f.store);assert.equal(f.sends.length,0);assert.equal(f.prompts.length,1);
 const r=await f.store.handle(event('/群总结 结果','auto-result'));assert.match(r.reply,/草莓/);await f.store.tick();assert.equal(f.prompts.length,1);await f.reopen();assert.equal(f.store.config(g).auto.nextAt,Date.parse('2026-11-09T13:00:00Z'));
});
test('manual jobs retain summary and actual delivery receipt separately',async t=>{
 const f=await fixture(t,{send:async()=>({ok:true,body:{data:{message_id:123456}}})});f.store.observe(row());const task=await f.store.handle(event('/群总结','proof'));await task.afterSend();await finish(f.store);
 const job=f.store.status(g,task.jobId),details=JSON.parse(job.details);assert.equal(job.status,'completed');assert.equal(job.sent,'sent');assert.equal(details.receipt.body.data.message_id,123456);assert.equal(details.selectedRows,1);
});

test('a length-limited local response never publishes a dangling sentence',()=>{
 assert.equal(finishDigestText({text:'讨论了内存容量。接下来关于 pdd',finishReason:'length'}),'讨论了内存容量。');
 assert.equal(finishDigestText({text:'普通结尾',finishReason:'stop'}),'普通结尾');
 assert.throws(()=>finishDigestText({text:'未写完',finishReason:'length'}),/截断/);
});
