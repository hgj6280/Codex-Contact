import test from 'node:test';
import assert from 'node:assert/strict';
import {naturalReplyBubbles,sendNaturalReply} from './qq-natural-replies.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {protectQqModelIdentity} from './qq-model-identity.mjs';
import {tryQqVoiceReply} from './qq-voice-replies.mjs';
import {splitQqLongReply,sendQqLongReply} from './qq-reply-length.mjs';
import {videoTextSegments} from './qq-video-summary.mjs';
const event={autonomyExpected:true,autonomyActions:[],autonomyQuote:true};
test('ordinary replies split finished paragraphs, not images, commands, code or excessive fragments',()=>{
  assert.deepEqual(naturalReplyBubbles(event,'是有点好笑。\n\n但这次还挺像的。'),['是有点好笑。','但这次还挺像的。']);
  for(const text of ['好啦\n\n[[qq_image:/generated.png]]','```\n\na\n```','1\n\n2\n\n3\n\n4','你好\n\n[[qq_sticker:开心.webp]]'])assert.deepEqual(naturalReplyBubbles(event,text),[text]);
  for(const e of [{},{...event,desktopDraft:true},{...event,autonomyActions:[{type:'mute'}]}])assert.equal(naturalReplyBubbles(e,'甲\n\n乙').length,1);
});
test('normal group/private transport sends all bubbles once and quotes only the first',async()=>{
  const writes=[];const r=await sendNaturalReply({event,reply:'先说一句。\n\n再补个想法。\n\n[[qq_sticker:开心.webp]] 不强行追问。',send:async(text,options)=>{writes.push({text,options});return {ok:true};}});
  assert.equal(r.ok,true);assert.equal(writes.length,3);assert.deepEqual(writes.map(x=>x.options.quoteSource),[true,false,false]);assert.equal(r.sentReply,r.bubbles.join('\n\n'));
});
test('unknown delivery, a new human reply, AI-off or session reset stops the remaining bubbles without retries',async()=>{
  let calls=0;
  const uncertain=await sendNaturalReply({event,reply:'甲\n\n乙\n\n丙',send:async()=>{calls++;if(calls===2)throw Error('timeout');return {ok:true};}});
  assert.equal(calls,2);assert.equal(uncertain.ok,false);assert.equal(uncertain.partial,true);assert.equal(uncertain.sentReply,'甲');
  const changed=await sendNaturalReply({event,reply:'甲\n\n乙',canContinue:i=>i===0,send:async()=>({ok:true})});
  assert.equal(changed.sentReply,'甲');assert.equal(changed.ok,false);
});
test('production group and private senders use normal bubbles, verify native receipts and record each send independently',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function sendOneBotGroupReply('),source.indexOf('async function buildOneBotPrivateReplyMessage('));
  const writes=[],records=[],state={channels:{qq:true},qq:{disabledConversations:[]}};
  const host=vm.createContext({currentQqName:()=>'测试角色',protectQqModelIdentity,tryQqVoiceReply,splitQqLongReply,sendQqLongReply,videoTextSegments,qqLife:null,sendNaturalReply,state,qqAutonomy:{canContinue:()=>state.channels.qq},qqGroupMuteGuard:{blocked:()=>false},isQqConversationAiEnabled:()=>true,
    assistantName:'狐宫静',oneBotApiBase:'http://native.test',console,
    buildOneBotReplyMessage:async(e,text,options)=>({text,...options}),buildOneBotPrivateReplyMessage:async text=>({text}),
    qqChat:{record:async message=>records.push(message)},sendQqGroupBubbles:()=>assert.fail('Normal autonomy must use daily transport'),
    bridgeFetch:async(url,options)=>{writes.push({url,...JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({status:'ok',retcode:0,data:{message_id:writes.length}})};}});
  vm.runInContext(code,host);
  assert.equal((await host.sendOneBotGroupReply({...event,groupId:'20012'},'甲\n\n乙')).ok,true);
  assert.equal((await host.sendOneBotPrivateReply({...event,senderId:'10014'},'丙\n\n丁')).ok,true);
  assert.deepEqual(writes.map(w=>w.group_id||w.user_id),[20012,20012,10014,10014]);
  assert.deepEqual(writes.slice(0,2).map(w=>w.message.quoteSource),[true,false]);assert.equal(records.length,4);
  state.channels.qq=false;await host.sendOneBotPrivateReply({...event,senderId:'10014'},'不发\n\n后续');assert.equal(writes.length,4);
});
