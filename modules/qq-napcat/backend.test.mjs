import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureQqBackend,recoverQqLogin,qqBackendInfo} from './backend.mjs';

test('native backend starts only its managed agent and never calls Docker',async()=>{
  const calls=[],exec=async(file,args)=>{calls.push([file,args]);if(args[0]==='print')throw Error('not registered');return {stdout:''};};
  assert.equal(await ensureQqBackend({exec,read:async()=>'{"kind":"native"}',home:'/local/user',uid:501}),'native');
  assert.deepEqual(calls.map(c=>c[1][0]),['print','bootstrap','kickstart']);
  assert.ok(calls.every(c=>c[0]==='/bin/launchctl'));
  calls.length=0;
  await ensureQqBackend({exec:async(f,a)=>{calls.push([f,a]);return {stdout:'state = running'};},read:async()=>'{"kind":"native"}'});
  assert.equal(calls.length,1);
});
test('SnowLuma starts only its preinstalled scoped container after stopping NapCat',async()=>{
 const calls=[],exec=async(f,a)=>{calls.push([f,a]);return {stdout:''};};
 assert.equal(await ensureQqBackend({exec,read:async()=>'{"kind":"snowluma","profile":"qq-contact"}'}),'snowluma');
 assert.deepEqual(calls.slice(1).map(c=>c[1]),[
  ['--context','colima-qq-contact','inspect','codex-contact-snowluma'],
  ['--context','colima-qq-contact','stop','codex-contact-napcat'],
  ['--context','colima-qq-contact','start','codex-contact-snowluma']
 ]);
 const unavailable=[];
 await assert.rejects(ensureQqBackend({read:async()=>'{"kind":"snowluma","profile":"qq-contact"}',exec:async(f,a)=>{unavailable.push(a);if(a.includes('inspect'))throw Error('missing');return {stdout:''};}}),/missing/);
 assert.ok(unavailable.every(a=>!a.includes('stop')&&!a.includes('start')));
 await assert.rejects(ensureQqBackend({read:async()=>'{"kind":"snowluma"}',exec:()=>assert.fail('unscoped VM forbidden')}),/isolated/);
});
test('login recovery preserves the selected engine and exposes fixed loopback URLs only',async()=>{
 const calls=[];
 await recoverQqLogin({read:async()=>'{"kind":"snowluma","profile":"qq-contact"}',exec:async(f,a)=>{calls.push(a);return {stdout:''};},recovery:{tick:async()=>({phase:'checking'})}});
 assert.deepEqual(calls.at(-1),['--context','colima-qq-contact','start','codex-contact-snowluma']);
 assert.equal(qqBackendInfo({kind:'snowluma',loginUrl:'https://evil.invalid'}).loginUrl,'http://127.0.0.1:6081/vnc.html?autoconnect=1&resize=scale');
 assert.match(qqBackendInfo({kind:'native'}).loginUrl,/6099/);
});
test('native failures and invalid configuration never fall back to the VM',async()=>{
  let calls=0;
  for(const config of ['{"kind":"native"}','{"kind":"invalid"}','{']) {
    await assert.rejects(ensureQqBackend({exec:async(f)=>{assert.equal(f,'/bin/launchctl');calls++;throw Error('failed');},read:async()=>config}));
  }
  assert.equal(calls,2);
});
test('unmigrated installations keep their existing Docker startup behavior',async()=>{
  const calls=[];
  const result=await ensureQqBackend({read:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});},exec:async(f,a)=>{calls.push([f,a]);return {stdout:''};}});
  assert.equal(result,'docker');
  assert.equal(calls[0][0],'/opt/homebrew/bin/colima');
  assert.deepEqual(calls[1][1],['--context','colima','start','codex-contact-napcat']);
});
test('pending native migration stays offline without starting QQ or the VM',async()=>{
  await assert.rejects(ensureQqBackend({read:async()=>'{"kind":"native-pending"}',exec:()=>assert.fail('must not launch')}),/等待本机签名授权/);
});
test('scoped Linux backend restarts its small ARM VM without changing the default Docker context',async()=>{
  const calls=[];const exec=async(f,a)=>{calls.push([f,a]);if(a.at(-1)==='status')throw Error('stopped');return {stdout:''};};
  await ensureQqBackend({exec,home:'/local/user',read:async()=>'{"kind":"docker","profile":"qq-contact"}'});
  assert.deepEqual(calls[0][1],['--profile','qq-contact','status']);
  const start=calls[1][1];assert.equal(start[start.indexOf('--memory')+1],'2');assert.equal(start[start.indexOf('--cpu')+1],'2');assert.ok(start.includes('--activate=false'));
  assert.deepEqual(calls[2][1],['--context','colima-qq-contact','start','codex-contact-napcat']);
  await assert.rejects(ensureQqBackend({exec:()=>assert.fail('must not touch another VM'),read:async()=>'{"kind":"docker","profile":"unrelated"}'}),/Unknown QQ Docker profile/);
});
test('login button can start a stopped Linux container, while native login keeps its bounded recovery path',async()=>{
 const calls=[];const recovery={tick:async options=>{assert.equal(options.manual,true);return {phase:'checking'};}};
 const exec=async(f,a)=>{calls.push([f,a]);return {stdout:''};};
 await recoverQqLogin({exec,recovery,read:async()=>'{"kind":"docker","profile":"qq-contact"}'});
 assert.deepEqual(calls.at(-1)[1],['--context','colima-qq-contact','start','codex-contact-napcat']);calls.length=0;
 await recoverQqLogin({exec,recovery,read:async()=>'{"kind":"native"}'});assert.equal(calls.length,0);
});
