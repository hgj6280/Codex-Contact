import test from 'node:test';
import assert from 'node:assert/strict';
import {limitQqReplyText,qqResponseIntent,splitQqLongReply,sendQqLongReply} from './qq-reply-length.mjs';
import {qqVoicePolicy,finishQqVoiceReply} from './qq-voice-replies.mjs';
test('useful long responses remain intact rather than blindly clipping at 900 chars',()=>{
  const response='这是一段完整的解释。'.repeat(200);
  assert.equal(limitQqReplyText(response),response);
});
test('explicit text/list requests override voice, preserve long text and do not resume the old topic',()=>{
  for(const text of ['你用文字回复都列出来','我说盘点一下世界前十大烂尾工程，你用文字来罗列','详细解释一下，用文字回复']){
    const e={type:'group_at',text};assert.equal(qqResponseIntent(text).textOnly,true);assert.equal(qqResponseIntent(text).detailed,true);assert.equal(qqVoicePolicy(e,{qqEnabled:true,qqMode:'voice'}),'text');
    e.qqVoiceRequested=true;assert.equal(finishQqVoiceReply(e,'完整文字回答'),'完整文字回答');assert.equal(e.qqVoiceRequested,false);
  }
  assert.equal(qqResponseIntent('你好呀').detailed,false);assert.equal(qqResponseIntent('不要展开，简短回答就行').detailed,false);
});
test('transport chunks all numbered items and Unicode losslessly; a failed chunk stops without retry',async()=>{
  const text=Array.from({length:10},(_,i)=>`${i+1}. 第${i+1}项 🦊\n${'详细解释。'.repeat(90)}\n\n`).join(''),parts=splitQqLongReply(text);assert.ok(parts.length>1);assert.equal(parts.join(''),text);assert.ok(parts.every(p=>Array.from(p).length<=1800&&p.isWellFormed()));
  let count=0;const result=await sendQqLongReply(text,async()=>({ok:++count!==2}));assert.equal(result.partial,true);assert.equal(count,2);assert.equal(result.sentReply,parts[0]);
});
test('extreme output keeps complete sentences, Unicode and real outgoing image markers',()=>{
  const image='[[qq_image:/safe/current-image.png]]',sticker='[[qq_sticker:狐狸.png]]';
  const result=limitQqReplyText('🦊每句话都完整。'.repeat(1000)+'\n'+image+'\n'+sticker);
  assert.ok(result.isWellFormed());assert.match(result,/完整。\n…/);
  assert.ok(result.endsWith(image+'\n'+sticker));assert.ok(Array.from(result).length<=6000);
});
