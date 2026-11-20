import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {openQqAiSessions,isQqNewSessionCommand,filterQqSessionEntries} from './qq-ai-sessions.mjs';

test('/new is an exact explicit command, including QQ mention, not ordinary conversation',()=>{
  for(const s of ['/new',' /NEW ','[CQ:at,qq=10011] /new'])assert.equal(isQqNewSessionCommand(s),true);
  for(const s of ['/newspaper','看看/new怎么用','/new do something','[CQ:image,file=x] /new'])assert.equal(isQqNewSessionCommand(s),false);
});
test('session resets persist per group/private chat without deleting history or leaking late old replies',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-ai-sessions-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'sessions.json'),group={groupId:'20010'},other={groupId:'20014'},privateChat={type:'private_message',senderId:'10012'};
  const now=()=> '2026-10-23T15:00:00.000Z';let count=0;
  const store=await openQqAiSessions(path,{now,uuid:()=> 'new-'+(++count)});
  const entries=[{at:'2026-10-23T14:00:00Z',text:'old'},{at:'2026-10-23T16:00:00Z',aiSessionId:'default',text:'late old reply'},{at:'2026-10-23T16:00:00Z',aiSessionId:'new-1',text:'new'}];
  const session=await store.reset(group);assert.equal(session.id,'new-1');
  assert.equal(store.snapshot(other).id,'default');assert.equal(store.snapshot(privateChat).id,'default');
  assert.deepEqual(filterQqSessionEntries(entries,session).map(e=>e.text),['new']);assert.equal(entries.length,3);
  const reopened=await openQqAiSessions(path);assert.deepEqual(reopened.snapshot(group),session);
  await store.reset(privateChat);assert.equal(store.snapshot(group).id,'new-1');
  assert.ok(JSON.parse(await readFile(path,'utf8')).sessions['private:10012']);
});
test('a failed boundary save does not report success or discard the existing session',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-ai-sessions-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openQqAiSessions(join(dir,'sessions.json'),{save:async()=>{throw Error('disk');}}),event={groupId:'20010'};
  await assert.rejects(store.reset(event),/disk/);assert.equal(store.snapshot(event).id,'default');
});
test('production /new handler resets only the current chat and never invokes a model or deletes QQ records',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('async function buildQqSessionCommandAction(event)'),end=source.indexOf('function buildQqCommandAction',start);
  let resets=0;const event={groupId:'20010',text:'/new'},state={qq:{proactive:{pendingImageRequests:{'20010':{text:'old'},'20014':{text:'keep'}}}}};
  const run=vm.runInNewContext(source.slice(start,end)+'\nbuildQqSessionCommandAction',{isQqNewSessionCommand,state,qqAiSessions:{reset:async e=>{assert.equal(e,event);resets++;return {id:'new',after:'now'};}}});
  const reply=await run(event);assert.match(reply.reply,/上下文已重置/);assert.equal(resets,1);assert.equal(event.aiSession.id,'new');
  assert.equal(state.qq.proactive.pendingImageRequests['20010'],undefined);assert.ok(state.qq.proactive.pendingImageRequests['20014']);
  assert.equal(await run({text:'normal'}),null);assert.equal(resets,1);
  assert.ok(source.includes('filterQqSessionEntries'));
  assert.ok(!source.includes('continuationPrompt:'));
});
