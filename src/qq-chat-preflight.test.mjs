import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveJsonAtomic} from './atomic-json.mjs';
import {parseModerationCommand} from './qq-moderation.mjs';
import {openQqChat} from './qq-chat.mjs';
import {isImageGenerationRequest} from './qq-codex-images.mjs';

test('production preflight filters passive messages before model queue and provides safe fast paths',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');const start=source.indexOf("  if(req.method==='POST'&&req.url==='/api/onebot/check')");const end=source.indexOf('  if (req.method === "POST" && req.url === "/api/onebot/event")',start);assert.ok(start>0&&end>start);
  const run=async({authorized=true,respond=true,banned=false,text='ordinary',self_id=10011,user_id=10012}={})=>{
    let recorded=0;const raw={post_type:'message',message_type:'group',self_id,user_id},state={qq:{events:[]}};
    const context={req:{method:'POST',url:'/api/onebot/check',headers:{}},res:{},desktopSecret:'test',state,qqAutonomy:null,qqCompanion:null,qqGroupMuteGuard:{refresh:async()=>{}},
      matchesDesktopKey:()=>authorized,readBody:async()=>raw,syncAiContacts:async()=>({stale:false,account:{id:'10011'}}),
      normalizeOneBotEvent:()=>({groupId:'20010',text,senderId:String(user_id),selfId:String(self_id)}),enrichQqEvent:e=>e,isBannedQqSender:()=>banned,attachReplyContext:async e=>{assert.equal(banned,false,'ignored bot must not fetch quoted context');return e;},
      rememberQqGroupMessage:async()=>{recorded++;},noteQqImageRequest:()=>{},shouldRespondToQq:()=>({ok:respond}),stripMentionText:t=>t,parseModerationCommand,
      isUsageQuestion:t=>t==='token',isQqModelQuestion:t=>t==='/model',isImageGenerationRequest,crypto:{randomUUID:()=> 'id'},sendJson:(_res,status,body)=>({status,body})};
    const result=await vm.runInNewContext(`(async()=>{${source.slice(start,end)}})()`,context);return {...result,recorded,state};
  };
  assert.equal((await run({authorized:false})).status,403);assert.equal((await run({user_id:10011})).recorded,0);
  const ignored=await run({respond:false});assert.equal(ignored.body.respond,false);assert.equal(ignored.state.qq.events.length,1);
  assert.equal((await run({respond:false,banned:true,user_id:10025,text:'/model 狐宫静'})).body.respond,false);
  assert.equal((await run()).body.fast,false);for(const text of ['token','/model','/new','/禁言 10010 10分钟'])assert.equal((await run({text})).body.fast,true);
  assert.equal((await run({text:'画一张狐宫静'})).body.imageRequested,true);
  assert.equal((await run({text:'画一张狐宫静',respond:false})).body.imageRequested,false);
});
test('atomic memory writes are serialized and readers see only complete JSON',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'qq-atomic-'));t.after(()=>rm(folder,{recursive:true,force:true}));const path=join(folder,'memory.json');
  await Promise.all(Array.from({length:30},(_,index)=>saveJsonAtomic(path,{index,text:'x'.repeat(index*100)})));const value=JSON.parse(await readFile(path,'utf8'));assert.equal(value.index,29);assert.equal(value.text.length,2900);
});
test('historical picture restoration cannot fetch an arbitrary/cross-group message',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'qq-restore-'));t.after(()=>rm(folder,{recursive:true,force:true}));let group_id=20010;
  const chat=await openQqChat({directory:folder,allowedGroups:()=>['20010'],oneBotApiBase:'http://none.test',remoteImages:true,
    fetchOneBotMessage:async()=>({group_id,message:[{type:'image',data:{file:'QQFILE',url:'https://gchat.qpic.cn/fresh'}}]})});
  await chat.record({groupId:'20010',messageId:77,message:'[图片]'});await assert.rejects(chat.restore('20010','88'),/原消息不在/);
  group_id=20015;await assert.rejects(chat.restore('20010','77'),/所属群聊/);group_id=20010;
  assert.equal((await chat.restore('20010','77')).images.length,1);
});
