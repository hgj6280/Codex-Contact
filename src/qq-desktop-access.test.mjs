import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopKey,matchesDesktopKey,openDesktopDirectory,openDesktopManagement,desktopWriteActions} from './qq-desktop-access.mjs';
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'qq-desktop-access-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const now=()=>1790800000000;
  const model={offline:false,groups:[{group_id:20010,group_name:'群 A',group_all_shut:0}],friends:[{user_id:10012,nickname:'好友 A'}],members:[{user_id:10011,role:'admin',card:''},{user_id:10010,role:'member',card:'群友'},{user_id:10029,role:'admin',card:'管理'},{user_id:10031,role:'owner'}],writes:[],unknown:false,readback:true};
  const call=async(action,p={})=>{
    if(model.offline)throw new Error('offline');
    if(action==='get_login_info')return {user_id:10011,nickname:'狐宫静'};
    if(action==='get_friend_list')return structuredClone(model.friends);
    if(action==='get_group_list')return structuredClone(model.groups);
    if(action==='get_group_info')return structuredClone(model.groups.find(g=>g.group_id===p.group_id));
    if(action==='get_group_member_list')return structuredClone(model.members);
    if(action==='get_group_member_info')return structuredClone(model.members.find(m=>m.user_id===p.user_id)||{});
    if(!desktopWriteActions.has(action))throw new Error('unexpected action');model.writes.push({action,p});if(model.unknown)throw new Error('response lost');if(!model.readback)return {};
    const m=model.members.find(m=>m.user_id===p.user_id);
    if(action==='set_group_ban')m.shut_up_timestamp=p.duration?now()/1000+p.duration:0;
    if(action==='set_group_card')m.card=p.card;
    if(action==='set_group_admin')m.role=p.enable?'admin':'member';
    if(action==='set_group_name')model.groups[0].group_name=p.group_name;
    if(action==='set_group_whole_ban')model.groups[0].group_all_shut=p.enable?-1:0;
    if(action==='set_group_kick')model.members=model.members.filter(m=>m.user_id!==p.user_id);
    if(action==='set_friend_add_request'&&p.approve)model.friends.push({user_id:10019,nickname:'新好友'});
    return {};
  };
  const contacts=await openDesktopDirectory({directory,call});await contacts.refresh();
  const management=await openDesktopManagement({directory,contacts,call,now});
  const action=extra=>({kind:'ban',groupId:'20010',userId:'10010',duration:600,confirm:true,requestId:randomUUID(),...extra});
  return {directory,contacts,management,model,call,now,action};
}
test('desktop credential is private, stable and uses strict constant-time input comparison',async t=>{
  const {directory}=await fixture(t);const path=join(directory,'desktop.key'),key=await desktopKey(path);assert.equal(await desktopKey(path),key);assert.equal((await stat(path)).mode&0o777,0o600);
  assert.ok(matchesDesktopKey(key,key));assert.equal(matchesDesktopKey('é'.repeat(64),key),false);assert.equal(matchesDesktopKey('0'.repeat(64),key),false);
});
test('full directory sync follows additions/removals and offline data never authorizes a write',async t=>{
  const {contacts,model}=await fixture(t);model.groups.push({group_id:20015,group_name:'群 B'});model.friends.push({user_id:10019,nickname:'好友 B'});
  await contacts.assertFresh('20015');assert.equal(contacts.groups().length,2);assert.equal(contacts.users().length,2);
  model.groups.pop();await assert.rejects(contacts.assertFresh('20015'),/不是/);
  model.offline=true;assert.equal((await contacts.refresh(true)).stale,true);assert.equal(contacts.groups().length,1);await assert.rejects(contacts.assertFresh('20010'),/未能同步/);
});
test('real permissions deny ordinary users, peer admins, owner and self; mute/unmute are read back',async t=>{
  const {management,model,action}=await fixture(t);model.members[0].role='member';await assert.rejects(management.act(action()),/只有群管理员/);assert.equal(model.writes.length,0);
  model.members[0].role='admin';for(const id of ['10011','10029','10031'])await assert.rejects(management.act(action({userId:id})),/不能操作/);
  for(const duration of [-1,2592001,1.5])await assert.rejects(management.act(action({duration})),/时长/);
  const mute=action();assert.equal((await management.act(mute)).status,'verified');assert.equal((await management.act(mute)).status,'verified');assert.equal(model.writes.length,1);
  assert.equal((await management.act(action({duration:0}))).status,'verified');assert.equal(model.members[1].shut_up_timestamp,0);
});
test('group name, member card, whole mute, kick and admin have typed plans and verified outcomes',async t=>{
  const {management,model,action}=await fixture(t);
  for(const input of [{kind:'name',value:'新群名'},{kind:'card',value:'新名片'},{kind:'wholeBan',enable:true},{kind:'wholeBan',enable:false}])assert.equal((await management.act(action(input))).status,'verified');
  await assert.rejects(management.act(action({kind:'admin',enable:true})),/只有群主/);model.members[0].role='owner';
  assert.equal((await management.act(action({kind:'admin',enable:true}))).status,'verified');assert.equal((await management.act(action({kind:'admin',enable:false}))).status,'verified');
  assert.equal((await management.act(action({kind:'kick'}))).status,'verified');assert.equal(model.writes.at(-1).p.reject_add_request,false);
});
test('same command cannot run twice concurrently/restart; a missing readback is not called success',async t=>{
  const {management,model,action,directory,contacts,call,now}=await fixture(t);const input=action();await Promise.all([management.act(input),management.act(input)]);assert.equal(model.writes.length,1);
  await assert.rejects(management.act({...input,duration:60}),/冲突/);model.unknown=true;const lost=action();assert.equal((await management.act(lost)).status,'unknown');
  const reopened=await openDesktopManagement({directory,contacts,call,now});await reopened.act(lost);assert.equal(model.writes.length,2);
  model.unknown=false;model.readback=false;assert.equal((await management.act(action({duration:3600}))).status,'accepted');
  const audit=JSON.parse(await readFile(join(directory,'management.json'),'utf8'));assert.equal(Object.values(audit.actions).filter(a=>a.status==='unknown').length,1);
});
test('request flags stay private and different operation IDs cannot approve the same request twice',async t=>{
  const {management,action,model}=await fixture(t);const event={post_type:'request',request_type:'friend',self_id:10011,user_id:10019,flag:'secret-flag',comment:'hi'};
  await management.ingest({...event,self_id:123});assert.equal(management.requests().length,0);await management.ingest(event);await management.ingest(event);
  const requests=management.requests();assert.equal(requests.length,1);assert.equal(requests[0].flag,undefined);
  const a=action({kind:'request',target:requests[0].id,approve:true});const results=await Promise.allSettled([management.act(a),management.act({...a,requestId:randomUUID()})]);
  assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(model.writes.length,1);assert.equal(management.requests().length,0);
});
