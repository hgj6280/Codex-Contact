import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DEFAULT_QQ_TRIGGERS,normalizeQqTriggers,matchQqTrigger,createQqTriggerSettings,handleQqTriggerRequest} from './qq-triggers.mjs';
import {bindTriggerEditor} from '../modules/web-console/public/trigger-editor.mjs';
import {isQqConversationAiEnabled} from './qq-conversation-ai.mjs';

test('default migration preserves the old word; custom words are literal, deduplicated and bounded',()=>{
  assert.deepEqual(normalizeQqTriggers(),{enabled:true,words:['狐宫静']});
  const config=normalizeQqTriggers({enabled:true,words:' 静静， 小狐狸\nＦＯＸ;fox; a.* '});
  assert.deepEqual(config.words,['静静','小狐狸','FOX','a.*']);
  for(const text of ['静静你好','你好小狐狸','hello fOx','literal a.*'])assert.ok(matchQqTrigger(text,config));
  for(const text of ['狐宫静你好','anything','[CQ:image,file=静静.png]','[CQ:at,qq=20030,name=静静]'])assert.equal(matchQqTrigger(text,config),null);
  assert.equal(matchQqTrigger('aZZ',config),null);
  assert.equal(matchQqTrigger('静静',{...config,enabled:false}),null);
  for(const words of ['', ['x'.repeat(41)], Array.from({length:21},(_,i)=>String(i)),['\0'],['[CQ:at,qq=123]']])assert.throws(()=>normalizeQqTriggers({enabled:true,words}));
  assert.deepEqual(normalizeQqTriggers({enabled:false,words:''}),{enabled:false,words:[]});
});
test('keyword on/off respects bans, channel/group gates, private access and actual @',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function shouldRespondToQq(event)'),end=source.indexOf('\nfunction ',start+10);
  const state={channels:{qq:true},qq:{triggers:{enabled:true,words:['静静','小狐狸']},groupMode:'mention-only',enhancer:{enabled:false}}};
  const check=event=>vm.runInNewContext(source.slice(start,end)+'\nshouldRespondToQq(event)',{
    state,event,roleplay:{},matchQqTrigger,isQqConversationAiEnabled,isQqModelQuestion:()=>false,aiGroups:()=>['20010'],aiUsers:()=>['10012'],
    isBannedQqSender:e=>e.senderId==='10025',hasUnhandledQqAudio:()=>false,parseModerationCommand:()=>null,
    stripMentionText:t=>t,hasPendingQqImageRequest:()=>false,isMentionEvent:e=>e.hasSelfAtSegment
  });
  const human={type:'group_message',groupId:'20010',senderId:'10012',text:'小狐狸看这张图'};
  assert.equal(check(human).ok,true);assert.match(check(human).reason,/小狐狸/);
  assert.equal(check({...human,text:'狐宫静'}).ok,false);
  assert.equal(check({...human,senderId:'10025',hasSelfAtSegment:true}).ok,false);
  assert.equal(check({...human,groupId:'999'}).ok,false);
  state.qq.triggers.enabled=false;
  assert.equal(check(human).ok,false);assert.equal(check({...human,hasSelfAtSegment:true}).ok,true);
  assert.equal(check({...human,type:'private_message',groupId:undefined}).ok,true);
  state.channels.qq=false;assert.equal(check({...human,hasSelfAtSegment:true}).ok,false);
});
test('custom trigger with an image selects image inspection, not text-only Gemini',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function shouldInspectQqImages('),end=source.indexOf('\nfunction ',start+10);
  const context={state:{qq:{triggers:{enabled:true,words:['静静']}}},matchQqTrigger,
    hasAnyQqImageReference:()=>true,isExplicitQqAtEvent:()=>false,isQqImageLookRequest:()=>false,scoreQqTextInterest:()=>0};
  vm.runInNewContext(source.slice(start,end),context);
  assert.equal(context.shouldInspectQqImages({text:'静静这个图'},'这个图'),true);
  context.state.qq.triggers.enabled=false;
  assert.equal(context.shouldInspectQqImages({text:'静静这个图'},'这个图'),false);
});
test('settings serialize updates, reject stale revisions and retain old state on persistence failure',async()=>{
  let config=normalizeQqTriggers(),fail=false;
  const store=createQqTriggerSettings({read:()=>config,write:async next=>{if(fail)throw new Error('disk');config=next;}});
  const old=store.snapshot();
  const a=store.update({...old,words:['静静']}),b=store.update({...old,words:['其他']});
  await a;await assert.rejects(b,e=>e.status===409);
  fail=true;await assert.rejects(store.update({...store.snapshot(),enabled:false}),/disk/);
  assert.deepEqual(store.snapshot().words,['静静']);assert.equal(store.snapshot().enabled,true);
  const reopened=createQqTriggerSettings({read:()=>structuredClone(config),write:async()=>{}});
  assert.deepEqual(reopened.snapshot(),store.snapshot());
});
test('API restricts remote/cross-site writes and refuses malformed or empty enabled lists',async()=>{
  let config=normalizeQqTriggers();const store=createQqTriggerSettings({read:()=>config,write:async n=>{config=n;}});
  const call=async({local=true,method='POST',site,body={}}={})=>{
    let result;await handleQqTriggerRequest({url:'/api/qq/triggers',method,headers:{'sec-fetch-site':site}},null,
      {store,isLocalRequest:()=>local,readBody:async()=>body,sendJson:(_,status,data)=>{result={status,data};}});return result;
  };
  assert.equal((await call({local:false})).status,403);assert.equal((await call({site:'cross-site'})).status,403);
  assert.equal((await call({body:{enabled:true,words:[],revision:store.snapshot().revision}})).status,400);
  assert.equal((await call({method:'GET'})).data.words[0],'狐宫静');
  assert.equal((await call({body:{...store.snapshot(),words:'小狐狸, 静静'}})).status,200);
  assert.equal((await call({method:'PUT'})).status,405);
});
test('editor saves, toggles only saved words, preserves dirty edits and recovers failed writes',async()=>{
  const fields=Object.fromEntries(['text','toggle','save','reload','status'].map(n=>[n,{value:'',checked:false,disabled:false,textContent:'',listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}}]));
  let config=normalizeQqTriggers(),posts=0,fail=false;
  const store=createQqTriggerSettings({read:()=>config,write:async n=>{if(fail)throw new Error('disk');config=n;}});
  const editor=bindTriggerEditor({root:{querySelector:q=>fields[q.match(/data-trigger-(\w+)/)[1]]},
    api:async(_,body)=>body?(posts++,await store.update(body)):store.snapshot(),confirmReload:()=>false});
  assert.equal(fields.save.disabled,true);await editor.load();assert.equal(fields.text.value,'狐宫静');
  fields.text.value='小狐狸\n静静';fields.text.listeners.input();fields.toggle.checked=false;
  await fields.toggle.listeners.change();assert.equal(posts,0);assert.equal(fields.toggle.checked,true);
  await editor.load({force:true});assert.equal(fields.text.value,'小狐狸\n静静');
  await fields.save.listeners.click();assert.deepEqual(config.words,['小狐狸','静静']);
  fields.toggle.checked=false;await fields.toggle.listeners.change();assert.equal(config.enabled,false);assert.deepEqual(config.words,['小狐狸','静静']);
  fail=true;fields.toggle.checked=true;await fields.toggle.listeners.change();assert.equal(fields.toggle.checked,false);assert.match(fields.status.textContent,/保存失败/);
});
