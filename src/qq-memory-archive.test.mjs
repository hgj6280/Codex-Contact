import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openQqCompanion} from './qq-companion.mjs';
const person={type:'group_message',groupId:'20012',senderId:'10014'};
async function fixture(t,extra={}){const dir=await mkdtemp(join(tmpdir(),'qq-archive-'));let time=10000;const opts={now:()=>time,...extra};let store=await openQqCompanion(join(dir,'db.sqlite'),opts);t.after(()=>{store.close();return rm(dir,{recursive:true,force:true});});return {get store(){return store;},advance(ms){time+=ms;},async reopen(){store.close();store=await openQqCompanion(join(dir,'db.sqlite'),opts);}};}
test('complete evidence survives rolling context, restarts and fading; never crosses a person or group',async t=>{
  const f=await fixture(t);f.store.observe({...person,text:'上周在小岛探险看到了蓝色贝壳',messageId:'one'},'好看的贝壳');
  for(let i=0;i<130;i++){f.advance(1000);f.store.observe({...person,text:'聊一下不相关的日常 '+i,messageId:'later:'+i},'嗯');}
  assert.equal(f.store.archiveList(person).total,131);
  const recalled=f.store.recall({...person,text:'以前小岛探险蓝色贝壳'});assert.ok(recalled.some(r=>r.source==='archive'&&r.content.includes('蓝色贝壳')));
  await f.reopen();assert.equal(f.store.archiveList(person,{query:'贝壳'}).entries.length,1);
  assert.equal(f.store.archiveList({...person,senderId:'10017'}).total,0);
  assert.equal(f.store.archiveList({...person,groupId:'10018'}).total,0);
  f.store.forget(person,'all');assert.equal(f.store.archiveList(person).total,0);await f.reopen();assert.equal(f.store.archiveList(person).total,0);
});
test('historical revisions remain marked obsolete; pinned incidental memory survives fading, and explicit forgetting removes its sources',async t=>{
  const f=await fixture(t,{analyze:async prompt=>{const row=JSON.parse(prompt.split('\n').at(-1)).messages.at(-1);return JSON.stringify({facts:[{kind:'event',subject:'island',content:row.text,sourceId:row.sourceId,evidence:row.text,confidence:1,importance:0}]});}});
  f.store.observe({...person,text:'周末在小岛探险',messageId:'island'},'嗯');await f.store.flush({force:true});const id=f.store.list(person)[0].id;
  f.store.pin(person,id,true);f.advance(70*86400000);assert.equal(f.store.list(person)[0].retention.pinned,true);assert.ok(f.store.recall({...person,text:'小岛探险'}).length);
  f.store.pin(person,id,false);assert.equal(f.store.list(person)[0].retention.active,false);
  f.store.revise(person,id,'小岛计划已取消');const versions=f.store.archiveList(person).entries.filter(e=>e.kind==='fact');assert.equal(versions.length,2);assert.equal(versions.filter(e=>e.current).length,1);
  f.store.forget(person,id);assert.equal(f.store.archiveList(person).total,0);
});
