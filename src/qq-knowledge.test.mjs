import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openQqKnowledge} from './qq-knowledge.mjs';
const e={type:'group_message',selfId:'10011',groupId:'20011',senderId:'10012',text:'风铃公会几点集合？'};
const document=(content='风铃公会约好20点30分集合。')=>({title:'风铃公会说明',source:'管理员核对',scope:'conversation',enabled:true,content});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'qq-knowledge-')),path=join(dir,'knowledge.sqlite');let store=await openQqKnowledge(path);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {get store(){return store;},async reopen(){store.close();store=await openQqKnowledge(path);}};}
test('knowledge persists, uses real excerpts and isolates QQ accounts, groups and private scopes',async t=>{
  const f=await fixture(t),doc=f.store.save(e,document());assert.match(f.store.context(e).text,/20点30/);assert.equal(f.store.retrieve({...e,groupId:'20010'}).length,0);assert.equal(f.store.retrieve({...e,selfId:'10019'}).length,0);
  const p={...e,type:'private_message'};f.store.save(p,document('风铃公会私聊暗号是琥珀。'));assert.doesNotMatch(f.store.context(e).text,/琥珀/);assert.match(f.store.context(p).text,/琥珀/);assert.equal(f.store.retrieve({...p,senderId:'10019'}).length,0);
  f.store.save(e,{...document('风铃公会公共活动需要准时。'),scope:'shared'});assert.match(f.store.context({...e,groupId:'20010'}).text,/公共活动/);assert.doesNotMatch(f.store.context({...e,groupId:'20010'}).text,/20点30/);
  await f.reopen();assert.equal(f.store.read(e,doc.id).content,doc.content);assert.throws(()=>f.store.read({...e,groupId:'20010'},doc.id),/不属于/);
});
test('update, disable, delete and per-conversation retrieval switch take effect immediately',async t=>{
  const {store}=await fixture(t),a=store.save(e,document()),b=store.save(e,{...a,content:'风铃公会改为21点集合。'});assert.doesNotMatch(store.context(e).text,/20点30/);assert.match(store.context(e).text,/21点/);
  assert.throws(()=>store.save(e,a),/已被修改/);const off=store.save(e,{...b,enabled:false});assert.equal(store.retrieve(e).length,0);const on=store.save(e,{...off,enabled:true});
  const settings=store.settings(e);store.updateSettings(e,{...settings,enabled:false});assert.equal(store.retrieve(e).length,0);assert.equal(store.settings({...e,groupId:'20010'}).enabled,true);
  store.remove(e,on.id,on.revision);assert.equal(store.list(e).total,0);assert.throws(()=>store.remove(e,on.id,on.revision),/已变化/);
});
test('long text tail is indexed, Unicode stays intact and prompt excerpts have a strict budget',async t=>{
  const {store}=await fixture(t);store.save(e,document('一般说明。'.repeat(1800)+'最后风铃公会特别安排：在星河东门集合。🦊'));
  const rows=store.retrieve({...e,text:'星河东门集合'},{budget:500});assert.ok(rows.length);assert.match(JSON.stringify(rows),/星河东门/);assert.ok(JSON.stringify(rows).length<=500);assert.ok(JSON.stringify(rows).isWellFormed());assert.equal(store.retrieve({...e,text:'unrelated quantum experiment'}).length,0);
  assert.throws(()=>store.save(e,document('x'.repeat(200001))),/最多/);assert.throws(()=>store.save(e,document('abc\0def')),/文本/);assert.equal(store.list(e,{query:"' OR 1=1 --"}).total,0);
});
