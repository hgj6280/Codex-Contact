import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openQqGroupMuteGuard} from './qq-group-mute-guard.mjs';
test('only QQ-confirmed self mutes block that group; private chats/other groups remain free and unmute is detected',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-mute-'));t.after(()=>rm(dir,{recursive:true,force:true}));let time=100000,calls=0,until=400;
  const path=join(dir,'guard.json'),lookup=async(group,user)=>{calls++;return {group_id:group,user_id:user,shut_up_timestamp:until};};
  let guard=await openQqGroupMuteGuard(path,{now:()=>time,lookup});const event={groupId:'10028',selfId:'10011'};
  await guard.refresh('20010',event.selfId);assert.equal(calls,0);
  await guard.refresh(event.groupId,event.selfId,{force:true});assert.equal(guard.blocked(event),true);assert.equal(guard.blocked({...event,groupId:'20010'}),false);assert.equal(guard.blocked({selfId:event.selfId}),false);
  guard=await openQqGroupMuteGuard(path,{now:()=>time,lookup});assert.equal(guard.blocked(event),true);await guard.refresh(event.groupId,event.selfId);assert.equal(calls,1);
  time+=61000;until=0;await guard.refresh(event.groupId,event.selfId);assert.equal(calls,2);assert.equal(guard.blocked(event),false);
});
test('a failed membership read does not crash chat or erase an existing confirmed mute; account switches cannot reuse it',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-mute-fail-'));t.after(()=>rm(dir,{recursive:true,force:true}));let fail=false,time=100000;
  const g=await openQqGroupMuteGuard(join(dir,'g.json'),{now:()=>time,lookup:async(group,user)=>{if(fail)throw Error('native offline');return {group_id:group,user_id:user,shut_up_timestamp:500};}});
  const e={groupId:'10028',selfId:'10011'};await g.refresh(e.groupId,e.selfId,{force:true});fail=true;time+=61000;await g.refresh(e.groupId,e.selfId);assert.equal(g.blocked(e),true);
  await g.refresh(e.groupId,'10012');assert.equal(g.blocked(e),false);
});
