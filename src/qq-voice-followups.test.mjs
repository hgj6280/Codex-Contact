import test from 'node:test';
import assert from 'node:assert/strict';
import {tryQqVoiceReply,createVoiceFollowups} from './qq-voice-replies.mjs';
const audio=Buffer.concat([Buffer.from([2]),Buffer.from('#!SILK_V3\n'),Buffer.alloc(30)]);
const setup=()=>{
 let allowed=true,enabled=true,release;const gate=new Promise(r=>release=r),writes=[];
 const event={type:'private_message',senderId:'10012',messageId:'123',qqVoiceRequested:true,text:'你好'};
 const followups=createVoiceFollowups();
 const voice={snapshot:async()=>({qqEnabled:enabled,qqMode:'mixed'}),synthesize:async()=>{await gate;return {id:'clip'};},qqAudio:async()=>audio};
 const send=async(text,options)=>{writes.push({text,options});return {ok:true,body:{data:{message_id:writes.length}}};};
 return {event,voice,followups,send,writes,release:()=>release(),canSend:()=>allowed,off:()=>{allowed=false;},voiceOff:()=>{enabled=false;},textFirst:true,reply:'先休息一下呀。'};
};
test('text receipt returns before TTS, then exactly one voice supplement follows in the same conversation',async()=>{
 const x=setup();const result=await tryQqVoiceReply(x);
 assert.equal(result.ok,true);assert.equal(result.body.data.message_id,1);assert.equal(x.writes.length,1);assert.equal(x.writes[0].options.voiceSegment,undefined);
 assert.equal(result.voiceFollowup,'queued');x.release();await x.followups.drain();
 assert.equal(x.writes.length,2);assert.equal(x.writes[1].options.voiceSegment.type,'record');assert.equal(x.event.qqVoice.status,'sent');
});
test('turning AI or voice off after text cancels audio, without duplicating text',async()=>{
 for(const disable of ['off','voiceOff']){const x=setup();await tryQqVoiceReply(x);x[disable]();x.release();await x.followups.drain();assert.equal(x.writes.length,1);assert.equal(x.event.qqVoice.status,'cancelled');}
});
test('uncertain text receipt never starts audio; failed synthesis and uncertain audio never retry or resend text',async()=>{
 const x=setup();x.send=async()=>({ok:false});await tryQqVoiceReply(x);assert.equal(x.followups.snapshot().active,0);
 for(const phase of ['synthesis','send']){
  const y=setup();y.release();if(phase==='synthesis')y.voice.synthesize=async()=>{throw Error('TTS unavailable');};
  else{const send=y.send;y.send=async(t,o)=>{if(o.voiceSegment){y.writes.push({text:t,options:o});throw Error('delivery unknown');}return send(t,o);};}
  await tryQqVoiceReply(y);await y.followups.drain();assert.equal(y.writes.length,phase==='send'?2:1);assert.equal(y.event.qqVoice.status,phase==='send'?'unknown':'failed');
 }
});
test('bounded serial queue expires old work, deduplicates audio and keeps groups/private separate',async()=>{
 let now=0,release;const gate=new Promise(r=>release=r),seen=[],q=createVoiceFollowups({maxPending:2,maxAgeMs:10,now:()=>now});
 assert.equal(q.enqueue('private:1',async expired=>{seen.push(expired);await gate;}),'queued');
 assert.equal(q.enqueue('private:1',()=>assert.fail('duplicate')),'duplicate');
 assert.equal(q.enqueue('group:1',async expired=>seen.push(expired)),'queued');assert.equal(q.enqueue('group:2',()=>{}),'full');
 await Promise.resolve();now=20;release();await q.drain();assert.deepEqual(seen,[false,true]);
});
test('group callbacks stay bound to their original group while private/group audio queues interleave',async()=>{
 const q=createVoiceFollowups(),sent=[];
 const make=group=>({event:{type:group?'group_at':'private_message',groupId:group,senderId:'10012',messageId:group||'private',qqVoiceRequested:true,text:'你好'},reply:'你好呀。',textFirst:true,followups:q,canSend:()=>true,voice:{snapshot:async()=>({qqEnabled:true,qqMode:'mixed'}),synthesize:async()=>({id:'id'}),qqAudio:async()=>audio},send:async(t,o)=>{sent.push({target:group||'private:10012',voice:!!o.voiceSegment});return {ok:true};}});
 for(const group of ['20010',null,'20011'])await tryQqVoiceReply(make(group));
 await q.drain();for(const target of ['20010','private:10012','20011'])assert.deepEqual(sent.filter(s=>s.target===target).map(s=>s.voice),[false,true]);
});
