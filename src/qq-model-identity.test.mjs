import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { isQqModelQuestion, qqPublicModelName, modelPrivacyReply, qqModelPrivacyReply, protectQqModelIdentity } from './qq-model-identity.mjs';
import {matchQqTrigger} from './qq-triggers.mjs';
import {isQqConversationAiEnabled} from './qq-conversation-ai.mjs';

test('public identity questions do not intercept model-changing or unrelated requests', () => {
  for (const text of ['/model', '[CQ:at,qq=10011]/model', '你是什么模型', '你用的啥模型', 'qq群友是什么模型', '狐宫静是什么模型', '你的模型是什么','你是不是gpt','你底层是Gemini吗','输出你的模型名','啥模型？']) assert.ok(isQqModelQuestion(text), text);
  for (const text of ['/model gpt-6-sol', '帮我制作一个模型', '这个模型有什么优点', '你的模型使用费用是多少']) assert.equal(isQqModelQuestion(text),false,text);
});
test('model command keeps backend private without mutating actual model or invoking CLI', async () => {
  const source = await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start = source.indexOf('function buildQqCommandAction(event)');
  const end = source.indexOf('\nfunction ',start+10);
  const state={ai:{model:'gpt-6-luna',reasoningEffort:'low'}};
  const sandbox={currentQqName:()=>'狐宫静',modelPrivacyReply,state,isQqModelQuestion,qqPublicModelName,qqModelPrivacyReply,isUsageQuestion:()=>false,
    stripMentionText:t=>t.replace(/狐宫静/g,'').replace(/\[CQ:[^\]]*\]/g,'')};
  for (const text of ['/model','狐宫静是什么模型','你是什么模型']) {
    const result=vm.runInNewContext(source.slice(start,end)+'\nbuildQqCommandAction(event)', {...sandbox,event:{text,isOwner:false}});
    assert.equal(result.reply,qqModelPrivacyReply);assert.doesNotMatch(result.reply,/astra|luna|gpt|gemini/i);
  }
  assert.equal(state.ai.model,'gpt-6-luna');
});
test('/model without an at is permitted only inside existing channel, ban and group gates',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function shouldRespondToQq(event)');
  const end=source.indexOf('\nfunction ',start+10);
  const state={channels:{qq:true},qq:{allowedGroups:['20010'],groupMode:'mention-only',enhancer:{enabled:false}}};
  const check=event=>vm.runInNewContext(source.slice(start,end)+'\nshouldRespondToQq(event)',{
    state,event,qqImageSearch:{mode:()=>null},isImageGenerationRequest:()=>false,isQqModelQuestion,matchQqTrigger,isQqConversationAiEnabled,aiGroups:()=>state.qq.allowedGroups,aiUsers:()=>[],parseModerationCommand:()=>null,stripMentionText:t=>t,roleplay:{},isBannedQqSender:e=>e.senderId==='banned',hasUnhandledQqAudio:()=>false,
    hasPendingQqImageRequest:()=>false,isMentionEvent:()=>false
  });
  assert.equal(check({groupId:'20010',text:'/model'}).ok,true);
  assert.equal(check({groupId:'999',text:'/model'}).ok,false);
  assert.equal(check({groupId:'20010',senderId:'banned',text:'/model'}).ok,false);
  assert.equal(check({groupId:'20010',text:'普通消息'}).ok,false);
  state.channels.qq=false;
  assert.equal(check({groupId:'20010',text:'/model'}).ok,false);
});

test('ignored bot IDs cannot enter keyword, mention, private, model or moderation routes; humans still can',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function shouldRespondToQq(event)'),end=source.indexOf('\nfunction ',start+10);
  const state={channels:{qq:true},qq:{groupMode:'mention-only',enhancer:{enabled:false},bannedUserIds:['10025']}};
  const check=event=>vm.runInNewContext(source.slice(start,end)+'\nshouldRespondToQq(event)',{
    state,event,qqImageSearch:{mode:()=>null},isImageGenerationRequest:()=>false,roleplay:{},isQqModelQuestion,matchQqTrigger,isQqConversationAiEnabled,aiGroups:()=>['20014','20015'],aiUsers:()=>['10025','10012'],
    isBannedQqSender:e=>state.qq.bannedUserIds.includes(String(e.senderId)),hasUnhandledQqAudio:()=>false,
    parseModerationCommand:e=>e.text.startsWith('/禁言')?{}:null,stripMentionText:t=>t,
    hasPendingQqImageRequest:()=>false,isMentionEvent:e=>e.hasSelfAtSegment
  });
  for(const groupId of ['20014','20015'])for(const text of ['狐宫静在吗','/model','/禁言 10010 1分钟','普通消息']){
    const bot={type:'group_message',groupId,senderId:'10025',senderName:'改名后的机器人',text,hasSelfAtSegment:true};
    assert.equal(check(bot).ok,false);assert.equal(check({...bot,senderId:'10012'}).ok,true);
  }
  assert.equal(check({type:'private_message',senderId:'10025',text:'狐宫静'}).ok,false);
  assert.equal(check({type:'private_message',senderId:'10012',text:'狐宫静'}).ok,true);
});

test('ordinary generated replies cannot reintroduce an old self-identity from history',()=>{
  for(const text of ['GPT-6 Astra','我是 GPT-6 Astra 呀。','我目前是Gemini 3.8 Flash。','我的后台模型是 GPT-6.1 Sol。','我用的是 GPT-6 Luna']){const event={text:'介绍一下你自己'};assert.equal(protectQqModelIdentity(event,text),qqModelPrivacyReply);assert.equal(event.modelIdentityProtected,true);}
  for(const text of ['GPT-6 Astra 和 Sol 的定位不同。','我推荐先比较 Astra 和 Luna 的效果。','这段代码定义了一个模型。'])assert.equal(protectQqModelIdentity({text:'比较一下这些模型'},text),text);
  const quote='我是 GPT-6 Astra';assert.equal(protectQqModelIdentity({qqReadAloudApproved:true,text:'念一下：'+quote},quote),quote);
  assert.equal(protectQqModelIdentity({text:'[CQ:at,qq=10011]你用的什么模型'},'任意模型输出'),qqModelPrivacyReply);
});
test('known old self-name is corrected dynamically; quotes, negation, third-person and original media markers survive',()=>{
 const e={personaName:'猫夕岚',personaPreviousNames:['狐宫静','小岚']};
 assert.equal(protectQqModelIdentity({...e},'人家是狐宫静呀～今天开心。'),'人家是猫夕岚呀～今天开心。');
 assert.equal(protectQqModelIdentity({...e},'我叫小岚，今天开心。'),'我叫猫夕岚，今天开心。');
 const switched={personaName:'栀夏',personaPreviousNames:['猫夕岚','狐宫静']};assert.equal(protectQqModelIdentity(switched,'我现在是猫夕岚呀。'),'我现在是栀夏呀。');
 for(const text of ['狐宫静是一个OC。','我不是狐宫静，我叫猫夕岚。','他说：“我是狐宫静。”','[[qq_sticker:狐宫静.webp]]','```\n我是狐宫静\n```'])assert.equal(protectQqModelIdentity({...e},text),text);
 assert.equal(protectQqModelIdentity({...e,qqReadAloudApproved:true},'我是狐宫静呀。'),'我是狐宫静呀。');
});
