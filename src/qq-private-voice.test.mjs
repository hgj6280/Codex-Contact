import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {qqVoicePolicy,wantsQqVoice,tryQqVoiceReply,qqVoiceFollowups} from './qq-voice-replies.mjs';
import {isQqConversationAiEnabled} from './qq-conversation-ai.mjs';
const settings={qqEnabled:true,qqMode:'voice',qqMixedPercent:50};
const event=()=>({type:'private_message',senderId:'10012',text:'用语音打招呼',qqVoiceRequested:true,qqVoiceExplicit:true});
const audio=Buffer.concat([Buffer.from([2]),Buffer.from('#!SILK_V3\n'),Buffer.alloc(30)]);
const voice=(extra={})=>({snapshot:async()=>settings,synthesize:async()=>({id:'test-clip'}),qqAudio:async()=>audio,...extra});
test('the exact failed private requests now select speech; text/off/draft policies still win',()=>{
  for(const text of ['用语音打招呼','用语音给我打招呼','你用用语音和我打招呼吧']){const e={...event(),text};assert.equal(wantsQqVoice(e),true);assert.equal(qqVoicePolicy(e,settings),'voice');}
  assert.equal(qqVoicePolicy(event(),{...settings,qqMode:'text'}),'text');assert.equal(qqVoicePolicy(event(),{...settings,qqEnabled:false}),'text');assert.equal(qqVoicePolicy({...event(),desktopDraft:true},settings),'text');
});
test('production private sender sends text first then a separate record in the same private chat',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8'),start=source.indexOf('async function sendOneBotPrivateReply('),end=source.indexOf('async function buildOneBotPrivateReplyMessage',start),calls=[],records=[];
  const context={currentQqName:()=>'测试角色',event:event(),reply:'在呢，我是狐宫静。',protectQqModelIdentity:(_,text)=>text,tryQqVoiceReply,qqLife:{voice:voice()},state:{channels:{qq:true},qq:{disabledConversations:[]}},aiUsers:()=>['10012'],isQqConversationAiEnabled,
    oneBotApiBase:'http://onebot.invalid',assistantName:'狐宫静',splitQqLongReply:()=>[],buildOneBotPrivateReplyMessage:text=>[{type:'text',data:{text}}],qqChat:{record:async row=>records.push(row)},
    bridgeFetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({status:'ok',retcode:0,data:{message_id:1234}})};}};
  const result=await vm.runInNewContext(source.slice(start,end)+'\nsendOneBotPrivateReply(event,reply)',context);
  assert.equal(result.ok,true);await qqVoiceFollowups.drain();assert.equal(calls.length,2);assert.match(calls[0].url,/send_private_msg$/);assert.equal(calls[0].body.user_id,10012);assert.deepEqual(calls[0].body.message.map(s=>s.type),['text']);assert.deepEqual(calls[1].body.message.map(s=>s.type),['record']);assert.equal(records[0].userId,'10012');assert.equal(context.event.qqVoice.spokenText,'在呢，我是狐宫静。');
});
test('switching a private conversation off during synthesis sends neither record nor fallback text',async()=>{let allowed=true,calls=0;const result=await tryQqVoiceReply({event:event(),reply:'你好。',voice:voice({synthesize:async()=>{allowed=false;return {id:'test'};}}),canSend:()=>allowed,send:()=>{calls++;}});assert.equal(result.skipped,true);assert.equal(calls,0);});
test('off/removed friend blocks synthesis and uncertain submission cannot generate a duplicate text send',async()=>{let calls=0;const off=await tryQqVoiceReply({event:event(),reply:'你好。',voice:voice({synthesize:()=>assert.fail('ACL must win')}),canSend:()=>false,send:()=>{calls++;}});assert.equal(off.skipped,true);assert.equal(calls,0);await assert.rejects(tryQqVoiceReply({event:event(),reply:'你好。',voice:voice(),canSend:()=>true,send:async()=>{calls++;throw Error('QQ response uncertain');}}),/uncertain/);assert.equal(calls,1);});
test('only synthesis failure falls back to honest text; successful speech keeps the same shared path for groups',async()=>{const calls=[];await tryQqVoiceReply({event:event(),reply:'你好。',voice:voice({synthesize:async()=>{throw Error('busy');}}),canSend:()=>true,send:async(text,options)=>{calls.push({text,options});return {ok:true};}});assert.equal(calls.length,1);assert.match(calls[0].text,/语音没合成成功/);assert.equal(calls[0].options.voiceSegment,undefined);const g={...event(),type:'group_at',groupId:'20010'};await tryQqVoiceReply({event:g,reply:'你好。',voice:voice(),canSend:()=>true,send:async(_,options)=>{assert.equal(options.voiceSegment.type,'record');return {ok:true};}});});
