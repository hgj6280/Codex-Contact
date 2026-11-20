import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openCompanionLife,biliId,handleCompanionLifeRequest} from './qq-companion-life.mjs';
const BV='BV1Rbxg6WER5';
test('desktop memory opt-out and new-session boundary keep operator previews out of shared recall',async t=>{
  let boundary=0;const f=await fixture(t,{contextBoundary:()=>boundary}),id=randomUUID();
  await f.store.petChat({requestId:id,text:'本地界面测试，不记录',remember:false});
  for(let i=0;i<10&&f.store.petJob(id).status==='running';i++)await new Promise(r=>setImmediate(r));
  f.store.petAck(id);assert.equal(f.notes.length,0);assert.equal(f.store.petHistory().length,1);
  boundary=f.store.petJob(id).at;assert.equal(f.store.petHistory().length,0);
  await assert.rejects(f.store.petChat({requestId:randomUUID(),text:'无效开关',remember:'false'}),/开关/);
});
async function fixture(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'qq-life-'));let calls=[],notes=[],time=Date.parse('2026-10-29T14:00:00Z'),writes=0,writeFailure=false;
  const fetchImpl=async(url,options={})=>{
    const u=String(url);calls.push({url:u,options});let data;
    if(u.includes('/nav'))data={isLogin:true,mid:10026,uname:'测试账号'};
    else if(u.includes('/web-interface/view'))data={bvid:BV,aid:42,cid:99,title:'有来源的公开视频',owner:{name:'作者'},desc:'只有元数据，不代表看过画面'};
    else if(u.includes('/player/v2'))data={subtitle:{subtitles:[]}};
    else if(u.includes('/reply/add')||u.includes('/create/dyn')){writes++;if(writeFailure)throw Error('network reset');data={rpid:10023,dyn_id_str:'410'};}
    else throw Error('unexpected URL '+u);
    return {ok:true,json:async()=>({code:0,data})};
  };
  let store=await openCompanionLife({directory,now:()=>time,fetchImpl,owner:()=> '10012',routine:()=>({}),style:()=> '狐宫静人设',reply:async({text})=>({text:'接上 '+text,images:[],model:'test'}),analyze:async()=>JSON.stringify({impression:'只读了简介',score:4,topic:'公开项目'}),remember:(...args)=>notes.push(args),...options});
  t.after(()=>{store.close();return rm(directory,{recursive:true,force:true});});
  return {directory,get store(){return store;},calls,notes,get writes(){return writes;},failWrites(){writeFailure=true;},advance(ms){time+=ms;},async reopen(){store.close();store=await openCompanionLife({directory,now:()=>time,fetchImpl,owner:()=> '10012',reply:async()=>({text:'重启后',images:[]}),analyze:async()=>'',...options});}};
}
test('B站 ID and media inputs cannot fetch arbitrary URLs; read scope remains explicit and public only',async t=>{
  const f=await fixture(t);assert.equal(biliId('https://www.bilibili.com/video/'+BV+'/?x=1'),BV);assert.equal(biliId('http://127.0.0.1/secrets'),null);
  await assert.rejects(f.store.readVideo('http://127.0.0.1/secrets'));
  const v=await f.store.readVideo(BV);assert.equal(v.contentLevel,'metadata');assert.match(v.subtitleStatus,/未取得字幕/);
  await f.store.reflect(BV);assert.match(f.store.publicContext(),/只读过标题与简介/);assert.doesNotMatch(f.store.publicContext(),/10012/);
  assert.equal(f.store.history().length,1);assert.equal(f.calls.length,2);assert.equal(f.notes.length,0);
});
test('login verifies actual identity, stores secrets privately and never returns them in state or previews',async t=>{
  const f=await fixture(t);await assert.rejects(f.store.connect({SESSDATA:'secret',bili_jct:'csrf',DedeUserID:'999'}),/账号/);
  const me=await f.store.connect({SESSDATA:'secret',bili_jct:'csrf',DedeUserID:'10026'});assert.equal(me.uid,'10026');
  assert.doesNotMatch(JSON.stringify(f.store.snapshot()),/secret|csrf|SESSDATA/);
  assert.equal((await stat(join(f.directory,'bili-auth.json'))).mode&0o777,0o600);
  assert.match(await readFile(join(f.directory,'bili-auth.json'),'utf8'),/secret/);
});
test('a selected Bilibili identity cannot be silently replaced by another logged-in account',async t=>{
  const f=await fixture(t);f.store.update({revision:f.store.snapshot().revision,biliExpectedUid:'10013'});
  await assert.rejects(f.store.connect({SESSDATA:'secret',bili_jct:'csrf',DedeUserID:'10026'}),/指定/);
  assert.equal(f.store.snapshot().biliAccount,null);
});
test('publication binds reviewed text and account, is single-flight, and uncertain results never retry',async t=>{
  const f=await fixture(t);await f.store.connect({SESSDATA:'secret',bili_jct:'csrf'});await f.store.readVideo(BV);
  const draft=await f.store.draft({kind:'comment',bvid:BV,text:'这个项目的设计挺有意思'});
  await assert.rejects(f.store.publish({id:draft.id}),/审阅/);assert.equal(f.writes,0);
  await Promise.all([f.store.publish({id:draft.id,confirm:true}),f.store.publish({id:draft.id,confirm:true})]);assert.equal(f.writes,1);
  await f.store.publish({id:draft.id,confirm:true});assert.equal(f.writes,1);
  const uncertain=await f.store.draft({kind:'dynamic',text:'读了项目简介，先做个小记录'});f.failWrites();
  await assert.rejects(f.store.publish({id:uncertain.id,confirm:true}),/结果未确认/);const n=f.writes;
  await f.store.publish({id:uncertain.id,confirm:true});assert.equal(f.writes,n);
  await f.reopen();assert.equal((await f.store.publish({id:uncertain.id,confirm:true})).status,'unknown');
});
test('pet messages use same owner but are never forged QQ arrivals; memory waits for visible acknowledgement',async t=>{
  const f=await fixture(t),requestId=randomUUID();await f.store.petChat({requestId,text:'今天继续聊跑团'});
  for(let i=0;i<10&&f.store.petJob(requestId).status==='running';i++)await new Promise(r=>setImmediate(r));
  assert.equal(f.store.petJob(requestId).status,'completed');assert.equal(f.notes.length,0);
  f.store.petAck(requestId);f.store.petAck(requestId);assert.equal(f.notes.length,1);
  assert.equal(f.notes[0][0].platform,'pet');assert.equal(f.notes[0][0].raw,undefined);
  assert.equal(f.store.petHistory().length,1);await f.store.petChat({requestId,text:'今天继续聊跑团'});assert.equal(f.notes.length,1);
  await assert.rejects(f.store.petChat({requestId,text:'different'}),/占用/);
});
test('a proactive pet bubble needs an actual display acknowledgement and has a stable, deduplicated receipt',async t=>{
  const f=await fixture(t),id=randomUUID();assert.equal((await f.store.pushPet('在吗',id)).status,'offline');
  f.store.ping();const pending=f.store.pushPet('上次的跑团后来怎么样',id);
  assert.equal(f.store.ping().messages.length,1);f.store.petAck(id);const receipt=await pending;
  assert.equal(receipt.ok,true);assert.equal(receipt.channel,'pet');assert.equal(f.store.ping().messages.length,0);
  assert.equal((await f.store.pushPet('上次的跑团后来怎么样',id)).messageId,receipt.messageId);
});
test('closing the store cannot invent a display acknowledgement',async t=>{
  const f=await fixture(t);f.store.ping();const pending=f.store.pushPet('尚未显示',randomUUID());f.store.close();assert.equal((await pending).ok,false);
});
test('life analysis budget persists and default schedule performs zero network or model calls',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.store.tick(),{skipped:true});assert.equal(f.calls.length,0);
  await f.store.readVideo(BV);f.store.update({...f.store.snapshot(),dailyAnalysisLimit:1});await f.store.reflect(BV);
  await assert.rejects(f.store.reflect(BV),/上限/);await f.reopen();assert.equal(f.store.snapshot().analysisCallsToday,1);
});
test('local API rejects cross-site use and accepts B站 credentials only from native authenticated transport',async()=>{
  let calls=0;
  async function request(url,extra={}){let status,body;await handleCompanionLifeRequest({url,method:'POST',headers:{},...extra},{},{store:{connect:()=>{calls++;}},isLocalRequest:()=>true,matchesNativeKey:()=>false,readBody:async()=>({cookies:{SESSDATA:'secret'}}),sendJson:(_r,s,b)=>{status=s;body=b;}});return {status,body};}
  assert.equal((await request('/api/life/settings',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await request('/api/life/bili/connect')).status,400);assert.equal(calls,0);
});
