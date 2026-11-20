import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openGroupMemory,GROUP_MEMORY_POLICY,groupPeriod} from './qq-group-memory.mjs';
import {openQqCompanion,memoryTerms} from './qq-companion.mjs';
const time=Date.parse('2026-11-05T10:00:00+08:00');
const room='20011',a='10012',b='10019',self='10011';
const event=(id,text,extra={})=>({type:'group_message',groupId:room,senderId:a,senderLabel:'同名群友',selfId:self,text,raw:{message_id:id,time:time/1000},...extra});
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());return {db,s:openGroupMemory(db,{now:()=>time,terms:memoryTerms,hasSecret:s=>/password|密码/.test(s)})};}
test('shared topic has exact authored evidence, follows quotes and remains scoped to one group',t=>{
  const {s}=setup(t);const first=event('1','周六星河剧场跑团，八点在东门集合');s.observe(first);
  s.observe(event('2','苹果电脑的内存要多少',{senderId:b}));
  const reply=event('3','星河剧场跑团改成九点，还是东门',{senderId:b,replyMessageId:'1',replyContext:{messageId:'1',senderId:a}});
  s.observe(reply);s.delivered(reply);s.delivered(event('2','', {senderId:b}));
  const notes=s.list(event('4','星河剧场跑团'));
  assert.equal(notes.length,1);assert.deepEqual(notes[0].items.map(x=>[x.messageId,x.user]),[['1',a],['3',b]]);
  const context=s.context(event('4','星河剧场跑团几点？'));
  assert.match(context.text,/改成九点/);assert.doesNotMatch(context.text,/苹果电脑/);
  assert.ok(context.references.every(x=>x.groupId===room));assert.ok(context.text.length<=700);
  assert.equal(s.context(event('4','星河剧场跑团',{groupId:'20010'})).text,'');
  assert.equal(s.context({...reply,type:'private_message'}).text,'');
  assert.equal(s.context(event('4','我喜欢吃什么')).text,'');
});
test('duplicates, forged cross-room references, bot messages, secrets and drafts do not pollute evidence',t=>{
  const {s}=setup(t);assert.equal(s.observe(event('1','周末跑团准备')),true);assert.equal(s.observe(event('1','伪造重放')),false);
  const second=event('2','显卡性能测试',{replyMessageId:'1',replyContext:{messageId:'1',senderId:a,raw:{group_id:'20010'}}});s.observe(second);s.delivered(second);
  assert.equal(s.list(event('3','显卡性能'))[0].items.length,1);
  for(const e of [event('3','自己的话',{senderId:self}),event('4','草稿',{desktopDraft:true}),event('5','密码123'),event('6','/new'),event('7','旧消息',{raw:{message_id:'7',time:(time-8*86400000)/1000}})])assert.equal(s.observe(e),false);
  assert.equal(s.snapshot().workingMessages,2);
  assert.equal(s.observe(event('1','另一个群的独立记录',{groupId:'20010'})),true);
});
test('forget removes source excerpts and notes for only the requested author and group',t=>{
  const {s}=setup(t);s.observe(event('1','跑团周六八点'));const second=event('2','跑团改成九点',{senderId:b,replyMessageId:'1'});s.observe(second);s.delivered(second);
  s.forget(room,a);const notes=s.list(event('3','跑团'));assert.equal(notes.length,1);assert.deepEqual(notes[0].items.map(x=>x.user),[b]);
  s.clear('20010');assert.equal(s.snapshot().topics,1);s.clear(room);assert.equal(s.snapshot().topics,0);assert.equal(s.snapshot().workingMessages,0);
});
test('same-second corrections outrank earlier versions under the recall budget',t=>{
  const {s}=setup(t);let last;
  for(let i=0;i<14;i++){
    last=event(String(i),'星河剧场跑团集合改为编号'+i+'号门，'+('请按最新通知安排。'.repeat(30)),{replyMessageId:i?'0':undefined});s.observe(last);
  }
  s.delivered(last);const notes=s.list(event('query','星河剧场跑团集合'));
  assert.deepEqual(notes[0].items.map(x=>x.messageId),['8','9','10','11','12','13']);
  const recalled=s.context(event('query','星河剧场跑团集合在哪里？'));
  assert.match(recalled.text,/编号13号门/);assert.ok(recalled.text.length<=700);
});
test('working set is bounded and source batching needs zero model calls; period views use China calendar',t=>{
  const {s}=setup(t);const start=performance.now();
  for(let i=0;i<1000;i++)s.observe(event(String(i),'星河剧场跑团日程 '+i));
  assert.equal(s.snapshot().workingMessages,GROUP_MEMORY_POLICY.recentPerGroup);assert.equal(s.snapshot().extraModelCalls,0);assert.ok(s.snapshot().topics>0);
  const elapsedMs=performance.now()-start;t.diagnostic('1000-message indexed replay: '+Math.round(elapsedMs)+' ms');assert.ok(elapsedMs<10000);
  assert.equal(groupPeriod(Date.parse('2026-11-01T16:30Z'),'day'),'2026-11-02');assert.equal(groupPeriod(time,'week'),'2026-11-02');assert.equal(groupPeriod(time,'month'),'2026-11');assert.equal(groupPeriod(time,'year'),'2026');
});
test('topic retention caps only derived notes and removes matching FTS entries',t=>{
  const {db,s}=setup(t);
  for(let i=0;i<430;i++){
    const e=event(String(i),'独立的话题记录 '+i,{raw:{message_id:String(i),time:(time-(430-i)*900001)/1000}});
    s.observe(e);s.delivered(e);
  }
  assert.equal(s.snapshot().topics,400);assert.equal(db.prepare('SELECT count(*) AS n FROM group_memory_search').get().n,400);
  assert.equal(s.snapshot().workingMessages,240);
});
test('companion preserves restart, personal ownership, permission switches and forgotten source boundary',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-group-memory-')),path=join(dir,'memory.sqlite');let now=time,calls=0;
  let s=await openQqCompanion(path,{now:()=>now,canAnalyze:({scope})=>scope===`group:${room}`,analyze:async()=>{calls++;return '{}';}});
  t.after(async()=>{s.close();await rm(dir,{recursive:true,force:true});});
  const e=event('1','周六星河剧场跑团东门集合');s.incoming(e);s.incoming(e);s.observe(e,'好，东门集合');
  s.incoming(event('2','私人资料',{groupId:'20010'}));assert.equal(s.snapshot().groupMemory.workingMessages,1);
  s.close();s=await openQqCompanion(path,{now:()=>now});
  assert.match(s.context(event('3','星河剧场跑团在哪里',{senderId:b})).memory,/东门集合/);
  assert.equal(s.list(event('3','',{senderId:b})).length,0);assert.equal(s.context(event('3','星河剧场跑团',{groupId:'20010'})).memory,'');
  s.forget(e,'all');s.incoming(e);assert.equal(s.snapshot().groupMemory.workingMessages,0);assert.equal(s.groupMemories(e).length,0);
  now+=1000;s.incoming(event('4','新的消息',{raw:{message_id:'4',time:now/1000}}));assert.equal(s.snapshot().groupMemory.workingMessages,1);
  s.update({...s.snapshot(),enabled:false});s.incoming(event('5','禁用后不记录'));assert.equal(s.snapshot().groupMemory.workingMessages,1);assert.equal(calls,0);
});
