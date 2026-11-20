import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openQqChat} from './qq-chat.mjs';
import {openChatStorage,rollbackStoppedChat} from './qq-chat-storage.mjs';

function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'qq-storage-test-'));
 t.after(()=>rmSync(directory,{force:true,recursive:true}));
 return {directory,allowedGroups:()=>['20040','20041','20042','20043','20044','20045','20046','20047']};
}
test('migration retains the source and a full read-only byte copy, all rows, metadata and order',async t=>{
 const options=fixture(t),path=join(options.directory,'messages.json');
 const input={version:1,revision:99,seeded:true,names:{20040:'A'},requests:{},media:{k:{file:'local'}},
   groups:{20040:Array.from({length:151},(_,i)=>({text:'row '+i,at:'same',messageId:String(i)})),20041:[]}};
 const raw=JSON.stringify(input,null,2);writeFileSync(path,raw,{mode:0o600});
 const chat=await openQqChat(options),db=new DatabaseSync(join(options.directory,'messages.sqlite'),{readOnly:true});
 const report=JSON.parse(db.prepare('SELECT report FROM migration').get().report);db.close();
 assert.deepEqual([report.before,report.after,report.recentCompared,report.mediaCount],[151,151,100,1]);
 for(const f of [path,join(options.directory,report.backup)]){
  assert.equal(readFileSync(f,'utf8'),raw);assert.equal(statSync(f).mode&0o777,0o400);
 }
 assert.deepEqual(chat.messages('20040'),input.groups[20040]);assert.equal(chat.revision(),99);
});
test('eight concurrently active groups retain exact order, replay each ID once, and survive reopen',async t=>{
 const options=fixture(t);let observed=0;
 const chat=await openQqChat({...options,onRecord:()=>observed++});
 const groups=options.allowedGroups(),calls=[];
 for(let i=0;i<250;i++) for(const group of groups){
  // Ties plus an out-of-order timestamp, and the same message IDs in different groups.
  const raw={post_type:'message',message_type:'group',group_id:group,message_id:i+1,user_id:1,self_id:2,time:1700000000+(i%9),message:group+'/'+i};
  calls.push(chat.ingest(raw));if(i%5===0)calls.push(chat.ingest(raw));
 }
 await Promise.all(calls);
 const reopened=await openQqChat(options);
 for(const group of groups){
  const expected=Array.from({length:250},(_,i)=>i).sort((a,b)=>a%9-b%9).map(i=>group+'/'+i);
  assert.deepEqual(reopened.messages(group).map(m=>m.text),expected);
 }
 assert.equal(observed,2000);assert.equal(chat.revision(),2000);
});
test('hot rollback serializes concurrent messages on both sides and later restarts use JSON',async t=>{
 const options=fixture(t),chat=await openQqChat(options);
 const record=i=>chat.record({groupId:'20040',messageId:i,message:'row '+i});
 const [a,mode,b]=await Promise.all([record(1),chat.rollbackStorage(),record(2)]);
 assert.equal(mode.mode,'json');assert.equal(chat.storageMode(),'json');
 assert.equal(a.text,'row 1');assert.equal(b.text,'row 2');
 const reopened=await openQqChat(options);assert.equal(reopened.storageMode(),'json');
 assert.deepEqual(reopened.messages('20040').map(x=>x.text),['row 1','row 2']);
 assert.equal(rollbackStoppedChat(options.directory).mode,'json');
});
test('failed writes leave no partial state and a later transaction succeeds',t=>{
 const o=fixture(t),s=openChatStorage(o.directory);
 assert.throws(()=>s.write(()=>{s.group('20040',[{text:'not committed'}]);s.set('names','20040','not committed');throw Error('abort');}),/abort/);
 assert.deepEqual(s.data.groups,{});assert.deepEqual(s.data.names,{});
 s.write(()=>s.group('20041',[{text:'committed'}]));
 assert.equal(openChatStorage(o.directory).data.groups['20041'][0].text,'committed');
});
test('bad import keeps the original and complete backup and never publishes a partial database',t=>{
 const o=fixture(t),p=join(o.directory,'messages.json'),raw='{ incomplete';
 writeFileSync(p,raw);assert.throws(()=>openChatStorage(o.directory));
 assert.equal(readFileSync(p,'utf8'),raw);
 const b=readdirSync(o.directory).find(x=>x.startsWith('messages.before-sqlite-'));assert.equal(readFileSync(join(o.directory,b),'utf8'),raw);
 assert.equal(existsSync(join(o.directory,'messages.sqlite')),false);
});
