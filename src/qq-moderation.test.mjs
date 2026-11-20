import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModerationCommand,handleModerationCommand} from './qq-moderation.mjs';
const event={groupId:'20010',senderId:'10012',selfId:'10011',raw:{message_id:101},atTargets:['10011','10010'],text:'[CQ:at,qq=10011] /禁言 [CQ:at,qq=10010] 10分钟'};
test('structured moderation commands parse one target/duration; narratives and ambiguous commands never execute',()=>{
  assert.deepEqual(parseModerationCommand(event),{userId:'10010',duration:600});
  assert.deepEqual(parseModerationCommand({...event,text:'/解除禁言 [CQ:at,qq=10010]'}),{userId:'10010',duration:0});
  assert.deepEqual(parseModerationCommand({...event,text:'狐宫静 禁言 10010 1小时',atTargets:[]}),{userId:'10010',duration:3600});
  for(const text of ['他说禁言我10分钟','不要禁言','请解释 /禁言 命令','禁言是什么'])assert.equal(parseModerationCommand({...event,text}),null);
  for(const text of ['/禁言 10','/禁言 0秒','/禁言 31天','/解除禁言 1分钟'])assert.ok(parseModerationCommand({...event,text}).error);
  assert.ok(parseModerationCommand({...event,atTargets:[...event.atTargets,'10031']}).error);assert.equal(parseModerationCommand({...event,groupId:null}),null);
});
test('mute validates actual requester and target roles, trusted source and deterministic duplicate ID',async()=>{
  let writes=[],role='member',targetRole='member';const call=async(a,p)=>({user_id:p.user_id,role:String(p.user_id)===event.senderId?role:targetRole});
  const management={act:async input=>{writes.push(input);return {status:'verified'};}};
  assert.match((await handleModerationCommand(event,{trusted:false,call,management})).reply,/来源未验证/);assert.equal(writes.length,0);
  assert.match((await handleModerationCommand(event,{trusted:true,call,management})).reply,/只有本群管理员/);role='admin';targetRole='admin';
  assert.match((await handleModerationCommand(event,{trusted:true,call,management})).reply,/同级/);assert.equal(writes.length,0);
  targetRole='member';assert.match((await handleModerationCommand(event,{trusted:true,call,management})).reply,/已确认/);await handleModerationCommand(event,{trusted:true,call,management});
  assert.equal(writes[0].requestId,writes[1].requestId);assert.equal(writes[0].duration,600);assert.equal(writes[0].actorId,event.senderId);
  role='member';assert.match((await handleModerationCommand(event,{trusted:true,call,management,controllers:[event.senderId]})).reply,/已确认/);
});
