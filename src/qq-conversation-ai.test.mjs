import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeDisabledConversations,isQqConversationAiEnabled,createConversationAiSettings,handleConversationAiRequest} from './qq-conversation-ai.mjs';
import {bindConversationAi} from '../modules/web-console/public/conversation-ai-editor.mjs';
import {saveJsonAtomic} from './atomic-json.mjs';
import {matchQqTrigger} from './qq-triggers.mjs';
import {splitQqLongReply,sendQqLongReply} from './qq-reply-length.mjs';

test('group and private IDs do not collide; missing preferences preserve existing behavior',()=>{
  assert.deepEqual(normalizeDisabledConversations(),[]);
  assert.deepEqual(normalizeDisabledConversations(['123456','private:123456','123456']),['123456','private:123456']);
  assert.equal(isQqConversationAiEnabled({type:'group_at',groupId:'123456'},['123456']),false);
  assert.equal(isQqConversationAiEnabled({type:'private_message',senderId:'123456'},['123456']),true);
  assert.equal(isQqConversationAiEnabled({groupId:'999999'}),true);
  for(const value of [['../foo'],['private:bad'],['__proto__'],['123'],false])assert.throws(()=>normalizeDisabledConversations(value));
});
test('local persisted preferences survive restart, setting one chat leaves all others alone',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'qq-conversation-ai-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'settings.json');let list=[];
  const make=()=>createConversationAiSettings({read:()=>list,validateConversation:async id=>{if(!['20010','20014','private:10012'].includes(id))throw new Error('not a contact');},
    write:async next=>{await saveJsonAtomic(path,{disabledConversations:next});list=next;}});
  let store=make();await store.update({conversationId:'20010',enabled:false,revision:store.snapshot().revision});
  await store.update({conversationId:'private:10012',enabled:false,revision:store.snapshot().revision});
  assert.equal(isQqConversationAiEnabled({groupId:'20014'},store.snapshot().disabledConversations),true);
  list=JSON.parse(await readFile(path,'utf8')).disabledConversations;store=make();
  assert.deepEqual(store.snapshot().disabledConversations,['20010','private:10012']);
  await store.update({conversationId:'20010',enabled:true,revision:store.snapshot().revision});
  assert.deepEqual(store.snapshot().disabledConversations,['private:10012']);
  await assert.rejects(store.update({conversationId:'20030',enabled:true,revision:store.snapshot().revision}),/not a contact/);
});
test('stale parallel saves and storage failures do not silently replace preferences',async()=>{
  let list=[];const store=createConversationAiSettings({read:()=>list,validateConversation:async()=>{},write:async next=>{list=next;}});
  const revision=store.snapshot().revision;
  await store.update({conversationId:'20010',enabled:false,revision});
  await assert.rejects(store.update({conversationId:'20014',enabled:false,revision}),e=>e.status===409);
  const broken=createConversationAiSettings({read:()=>list,validateConversation:async()=>{},write:async()=>{throw new Error('disk');}});
  await assert.rejects(broken.update({conversationId:'20010',enabled:true,revision:broken.snapshot().revision}),/disk/);
  assert.deepEqual(list,['20010']);
});
test('off switch blocks keyword, @, model, moderation and proactive routes; private and other groups stay independent',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function shouldRespondToQq(event)'),end=source.indexOf('\nfunction ',start+10);
  const state={channels:{qq:true},qq:{disabledConversations:['20010','private:10012'],enhancer:{enabled:true},memory:{recentMessages:{}},groupMode:'mention-only'}};
  const check=event=>vm.runInNewContext(source.slice(start,end)+'\nshouldRespondToQq(event)',{state,event,roleplay:{},isQqConversationAiEnabled,matchQqTrigger,
    qqImageSearch:{mode:e=>/搜图/.test(e.text||'')?'manual':null},isImageGenerationRequest:()=>false,
    isBannedQqSender:e=>e.senderId==='10025',hasUnhandledQqAudio:()=>false,aiUsers:()=>['10012','10019'],aiGroups:()=>['20010','20014'],
    isQqModelQuestion:e=>e==='/model',parseModerationCommand:e=>e.text.startsWith('/禁言')?{}:null,stripMentionText:t=>t,
    hasPendingQqImageRequest:()=>false,shouldProactivelyReplyToQq:()=>({ok:true}),isMentionEvent:()=>true});
  for(const text of ['狐宫静你好','/model','/禁言 10010 1分钟','普通消息','搜图']){
    const event={type:'group_at',groupId:'20010',senderId:'10012',text,hasSelfAtSegment:true};
    assert.equal(check(event).ok,false);assert.equal(check({...event,groupId:'20014'}).ok,true);
  }
  assert.equal(check({type:'private_message',senderId:'10012',text:'你好'}).ok,false);
  assert.equal(check({type:'private_message',senderId:'10019',text:'你好'}).ok,true);
  assert.equal(check({groupId:'20014',senderId:'10025'}).ok,false);
  state.channels.qq=false;assert.equal(check({type:'private_message',senderId:'10019'}).ok,false);
});
test('a switch turned off while generation runs prevents actual auto delivery; manual paths remain independent',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function suppressDisabledConversationReply('),end=source.indexOf('\nfunction ',start+10);
  const state={channels:{qq:true},qq:{disabledConversations:['20010']}};
  const context={state,isQqConversationAiEnabled};vm.runInNewContext(source.slice(start,end),context);
  const record={event:{groupId:'20010'},reply:'late reply',decision:{ok:true}};
  context.suppressDisabledConversationReply(record);assert.equal(record.reply,null);assert.equal(record.send.skipped,true);
  const other={event:{groupId:'20014'},reply:'allowed'};context.suppressDisabledConversationReply(other);assert.equal(other.reply,'allowed');
  const delivery=source.slice(source.indexOf('source: "onebot",\n      event,\n      decision,\n      reply,'));
  assert.ok(delivery.indexOf('suppressDisabledConversationReply(record)')<delivery.indexOf('await sendOneBotPrivateReply'));
  const chat=await readFile(new URL('./qq-chat.mjs',import.meta.url),'utf8');assert.doesNotMatch(chat,/disabledConversations|isQqConversationAiEnabled/);
});
test('endpoint rejects remote/cross-site access and delegates only validated local conversation changes',async()=>{
  let list=[];const store=createConversationAiSettings({read:()=>list,write:async n=>{list=n;},validateConversation:async()=>{}});
  async function call(local,site,method='POST',body={}){let result;await handleConversationAiRequest({url:'/api/qq/conversation-ai',method,headers:{'sec-fetch-site':site}},null,
    {store,isLocalRequest:()=>local,readBody:async()=>body,sendJson:(_,status,data)=>{result={status,data};}});return result;}
  assert.equal((await call(false)).status,403);assert.equal((await call(true,'cross-site')).status,403);
  assert.equal((await call(true,undefined,'POST',{conversationId:'../bad',enabled:false})).status,400);
  assert.equal((await call(true,undefined,'GET')).status,200);
});
test('each auto bubble rechecks preferences after media preparation, before calling QQ; manual sends remain separate',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  for(const name of ['sendOneBotGroupMessage','sendOneBotPrivateMessage']){
    const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\nasync function ',start+10);
    const state={channels:{qq:true},qq:{disabledConversations:[]}};let calls=0;
    const prepare=async()=>{state.qq.disabledConversations=['20010','private:10012'];return [];};
    const context={state,splitQqLongReply,sendQqLongReply,qqGroupMuteGuard:{blocked:()=>false},isQqConversationAiEnabled,buildOneBotReplyMessage:prepare,buildOneBotPrivateReplyMessage:prepare,bridgeFetch:async()=>{calls++;throw new Error('must not send');}};
    vm.runInNewContext(source.slice(start,end),context);
    const result=await context[name]({type:name.includes('Private')?'private_message':'group_message',groupId:'20010',senderId:'10012'},'text');
    assert.equal(result.skipped,true);assert.equal(calls,0);
  }
});
test('UI captures selected chat, resists polling mid-save and handles errors without flipping another chat or the global switch',async()=>{
  const toggle={checked:false,disabled:false};let id='20010',release,posts=[];
  const config={disabledConversations:[],revision:'old'};
  const ui=bindConversationAi({toggle,selected:()=>id,conversation:()=>({aiAllowed:true}),notice(){},api:async(path,body)=>{
    posts.push({path,body});if(body)return new Promise(resolve=>{release=resolve;});return config;
  }});
  ui.update(config,true);assert.equal(toggle.checked,true);
  toggle.checked=false;const pending=toggle.onchange();
  assert.equal(toggle.checked,false,'pending write must not immediately flip the checkbox back');
  assert.equal(posts[0].path,'/api/qq/conversation-ai');assert.equal(posts[0].body.conversationId,'20010');
  id='private:10012';ui.update(config,true);assert.equal(toggle.checked,true);
  release({disabledConversations:['20010'],revision:'new'});await pending;
  assert.equal(toggle.checked,true);id='20010';ui.render();assert.equal(toggle.checked,false);
  ui.update({disabledConversations:['20010'],revision:'new'},false);assert.equal(toggle.checked,false);
  id='private:10012';ui.render();assert.equal(toggle.checked,true);assert.match(toggle.title,/总开关已关闭/);
  assert.equal(posts.some(p=>p.path==='/api/channel'),false);
});

 test('bulk group/private edits persist once, preserve unselected chats, and fail atomically',async()=>{
 let disabled=['20010'],writes=0;
 const store=createConversationAiSettings({read:()=>disabled,write:async v=>{writes++;disabled=v;},validateConversation:async id=>{if(id==='10020')throw Error('会话失效');}});
 await store.update({conversationIds:['20011','private:10012'],enabled:false,revision:store.snapshot().revision});
 assert.deepEqual(disabled,['20010','20011','private:10012']);assert.equal(writes,1);
 const revision=store.snapshot().revision;
 await assert.rejects(store.update({conversationIds:['20011','10020'],enabled:true,revision}),/失效/);assert.equal(writes,1);
 await store.update({conversationIds:['20011','private:10012'],enabled:true,revision});assert.deepEqual(disabled,['20010']);assert.equal(writes,2);
 await assert.rejects(store.update({conversationIds:['20011'],enabled:false,revision}),/其他页面/);
 });
