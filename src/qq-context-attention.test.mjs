import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {openQqAutonomy} from './qq-autonomy.mjs';
import {matchQqTrigger} from './qq-triggers.mjs';
import {isQqConversationAiEnabled} from './qq-conversation-ai.mjs';
import {isImageGenerationRequest} from './qq-codex-images.mjs';
const base={type:'group_message',groupId:'20012',senderId:'10014',selfId:'10015'};
const event=(id,text,extra={})=>({...base,text,raw:{message_id:id},...extra});
async function fixture(t,extra={}){
  const dir=await mkdtemp(join(tmpdir(),'qq-attention-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let time=Date.now(),on=true;const effects=[],options={now:()=>time,getRoutine:()=>({enabled:false}),allowed:e=>on&&e.senderId!=='10025',getIdentity:()=>({names:['狐宫静','静静']}),management:{requests:()=>[]},sendPrivate:async()=>effects.push('private'),...extra};
  const path=join(dir,'state.json');let s=await openQqAutonomy(path,options);
  return {get s(){return s},effects,advance:ms=>time+=ms,allow:v=>on=v,reopen:async()=>s=await openQqAutonomy(path,options)};
}
async function contextual(f,e,{target='self',intent='summon',ids=[String(e.raw.message_id)],actions=[],reply='在呢，找我什么事呀？'}={}){
  f.s.observe(e);e.proactiveDecision=f.s.candidate(e);assert.equal(e.proactiveDecision?.contextual,true);
  assert.match(f.s.prompt(e),/上下文指代判断/);
  return f.s.consume(e,JSON.stringify({mode:target==='self'?'reply':'silence',reply,actions,reason:'语义判断',attention:{target,intent,evidenceMessageIds:ids}}));
}
test('a short pronoun can refer to the bot in recent passive context without a prior bot reply or matching trigger',async t=>{
  const f=await fixture(t);f.s.observe(event(101,'狐宫静刚才还在群里说话吧'));f.advance(1000);
  const e=event(102,'她呢？',{senderId:'10017'});
  assert.equal(matchQqTrigger(e.text,{enabled:true,words:['狐宫静','静静']}),null);
  assert.ok(await contextual(f,e,{ids:['101','102']}));assert.equal(f.s.snapshot().recentActions[0].attention.target,'self');
  assert.equal(f.s.snapshot().recentActions[0].contextual,true);
});
test('cold ambiguous pronouns, expired references and cross-group references cannot acquire a bot identity',async t=>{
  const f=await fixture(t);const cold=event(1,'她呢');f.s.observe(cold);assert.equal(f.s.candidate(cold),null);
  f.s.observe(event(2,'狐宫静好像离线了'));f.advance(601000);const stale=event(3,'她呢');f.s.observe(stale);assert.equal(f.s.candidate(stale),null);
  const other=event(4,'她呢',{groupId:'20016'});f.s.observe(other);assert.equal(f.s.candidate(other),null);
});
test('a generic call is only a candidate; model other/unclear or missing/forged evidence produces silence',async t=>{
  const f=await fixture(t);
  assert.equal(await contextual(f,event(10,'群里的 AI 还在吗？'),{target:'other',intent:'unrelated'}),'');
  f.advance(31000);assert.equal(await contextual(f,event(11,'那个 AI 出来说句话呀'),{target:'unclear',intent:'unrelated'}),'');
  f.advance(31000);assert.equal(await contextual(f,event(12,'群里的 AI 还在吗？'),{ids:['12','different-group-message']}),'');
  f.advance(31000);const e=event(13,'群里的 AI 还在吗？');f.s.observe(e);e.proactiveDecision=f.s.candidate(e);f.s.prompt(e);
  assert.equal(await f.s.consume(e,'{"mode":"reply","reply":"误接","actions":[]}'),'');assert.deepEqual(await f.s.execute(e),[]);
});
test('short references require both the current message and the actual antecedent; contextual replies cannot perform management/private actions',async t=>{
  const f=await fixture(t);f.s.observe(event(20,'狐宫静在不在'));f.advance(1000);
  assert.equal(await contextual(f,event(21,'她呢'),{ids:['21']}),'');
  f.advance(31000);const e=event(22,'她呢');assert.ok(await contextual(f,e,{ids:['20','22'],actions:[{type:'private',userId:base.senderId,text:'不应发送'}]}));
  assert.deepEqual(e.autonomyActions,[]);assert.deepEqual(await f.s.execute(e),[]);assert.equal(f.effects.length,0);
});
test('a quote genuinely about the bot is usable, while directed conversations and other-scope quotes stay quiet',async t=>{
  const f=await fixture(t);
  const quote={messageId:'30',senderId:'10018',text:'狐宫静刚才在说跑团',isSelf:false,raw:{group_id:base.groupId}};
  const e=event(31,'她回来了吗',{replyContext:quote,atTargets:[quote.senderId]});
  assert.ok(await contextual(f,e,{ids:['30','31']}));
  f.advance(31000);for(const other of [event(32,'你在吗？',{atTargets:['10016']}),event(33,'她回来了吗',{replyContext:{...quote,text:'小林在说跑团'}}),event(34,'她回来了吗',{replyContext:{...quote,raw:{group_id:'20016'}}})]){f.s.observe(other);assert.equal(f.s.candidate(other),null);}
});
test('local history hydrates once per chat, excludes other scopes/ignored senders and respects /new without deleting history',async t=>{
  let loads=0;const at=new Date().toISOString(),rows=[{groupId:base.groupId,messageId:'41',senderId:'10018',text:'狐宫静刚才去哪了',at},
    {groupId:'20016',messageId:'42',senderId:'10018',text:'其他群秘密',at},
    {groupId:base.groupId,messageId:'43',senderId:'10025',text:'忽略的机器人',at}];
  const f=await fixture(t,{getRecentMessages:()=>{loads++;return rows;}}),e=event(44,'她呢');
  f.s.observe(e);e.proactiveDecision=f.s.candidate(e);assert.ok(e.proactiveDecision);const prompt=f.s.prompt(e);assert.match(prompt,/去哪了/);assert.doesNotMatch(prompt,/其他群秘密|忽略的机器人/);
  assert.ok(await f.s.consume(e,JSON.stringify({mode:'reply',reply:'我在呢',actions:[],attention:{target:'self',intent:'summon',evidenceMessageIds:['41','44']}})));
  f.s.observe(event(45,'其他消息'));assert.equal(loads,1);await f.s.reset(e);f.advance(31000);const after=event(46,'她呢');f.s.observe(after);assert.equal(f.s.candidate(after),null);assert.equal(rows.length,3);
});
test('switches cancel queued contextual replies, persist across restart and respect model-decision budgets',async t=>{
  const f=await fixture(t),e=event(50,'群里的 AI 在吗');f.s.observe(e);e.proactiveDecision=f.s.candidate(e);f.s.prompt(e);
  await f.s.update({revision:f.s.snapshot().revision,contextualReplies:false});assert.equal(f.s.canContinue(e,{first:true}),false);
  await f.reopen();assert.equal(f.s.snapshot().contextualReplies,false);f.s.observe(event(51,'群里的 AI 在吗'));assert.equal(f.s.candidate(event(51,'群里的 AI 在吗')),null);
  await f.s.update({revision:f.s.snapshot().revision,contextualReplies:true});
  for(let i=0;i<6;i++){f.advance(31000);await contextual(f,event(60+i,'群里的 AI 在吗'),{target:'unclear',intent:'unrelated'});}
  f.advance(31000);const limited=event(70,'群里的 AI 在吗');f.s.observe(limited);assert.equal(f.s.candidate(limited),null);
});
test('production group router admits contextual candidates only after ordinary channel, conversation, membership and ban gates',async t=>{
  const f=await fixture(t);f.s.observe(event(80,'狐宫静刚才去哪了'));const e=event(81,'她呢');f.s.observe(e);
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8'),start=source.indexOf('function shouldRespondToQq(event)'),end=source.indexOf('\nfunction ',start+10);
  const state={channels:{qq:true},qq:{triggers:{enabled:true,words:['狐宫静']},groupMode:'mention-only',enhancer:{enabled:false},disabledConversations:[]}};
  const check=e=>vm.runInNewContext(source.slice(start,end)+'\nshouldRespondToQq(event)',{qqImageSearch:{mode:()=>false},event:e,state,qqAutonomy:f.s,roleplay:{},matchQqTrigger,isQqConversationAiEnabled,isQqModelQuestion:()=>false,isImageGenerationRequest,
    aiGroups:()=>[base.groupId],aiUsers:()=>[],isBannedQqSender:e=>e.senderId==='10025',hasUnhandledQqAudio:()=>false,parseModerationCommand:()=>null,stripMentionText:t=>t,hasPendingQqImageRequest:()=>false,isMentionEvent:e=>e.hasSelfAtSegment});
  assert.equal(check(e).contextual,true);state.channels.qq=false;assert.equal(check(e).ok,false);state.channels.qq=true;
  state.qq.disabledConversations=[base.groupId];assert.equal(check(e).ok,false);state.qq.disabledConversations=[];
  assert.equal(check({...e,senderId:'10025'}).ok,false);assert.equal(check({...e,groupId:'20016'}).ok,false);
});
