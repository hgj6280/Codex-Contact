import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openNativeRecovery} from './native-recovery.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'qq-native-recovery-')),path=join(dir,'recovery.json');t.after(()=>rm(dir,{recursive:true,force:true}));
 let time=Date.parse('2026-11-02T09:00:00+08:00'),online=true,qr=0,native=true,idle=true,restarts=0,fail=false;
 const options={path,now:()=>time,probe:async()=>online,restart:async()=>{restarts++;if(fail)throw Error('launchctl unavailable');},qrModifiedAt:async()=>qr,isNative:async()=>native,isIdle:()=>idle};
 let store=await openNativeRecovery(options);
 return {get store(){return store;},advance:n=>time+=n,offline:()=>online=false,unknown:()=>online=null,online:()=>online=true,qr:()=>qr=time+1,setNative:x=>native=x,setIdle:x=>idle=x,setFail:x=>fail=x,get restarts(){return restarts;},async reopen(){store=await openNativeRecovery(options);},async corrupt(){await writeFile(path,'{broken');await this.reopen();}};
}
test('temporary offline and unknown transport do not reboot; persistent confirmed offline recovers once',async t=>{
 const f=await fixture(t);assert.equal((await f.store.tick()).phase,'online');f.offline();await f.store.tick();f.advance(30000);await f.store.tick();assert.equal(f.restarts,0);f.online();await f.store.tick();f.offline();await f.store.tick();f.advance(90000);await f.store.tick();assert.equal(f.restarts,1);f.unknown();f.advance(30000);await f.store.tick();assert.equal(f.restarts,1);f.online();assert.equal((await f.store.tick()).phase,'online');
});
test('new QR pauses recovery even across bridge restarts and expiry, and confirmed login resumes',async t=>{
 const f=await fixture(t);await f.store.tick();f.offline();await f.store.tick({manual:true});assert.equal(f.restarts,1);f.qr();f.unknown();f.advance(4000);assert.equal((await f.store.tick()).phase,'awaiting_scan');await f.reopen();f.advance(7200000);assert.equal((await f.store.tick({manual:true})).phase,'awaiting_scan');assert.equal(f.restarts,1);f.online();assert.equal((await f.store.tick()).phase,'online');
});
test('restart reservations survive failures and bridge restarts; manual clicks cannot exceed two per hour',async t=>{
 const f=await fixture(t);f.offline();f.setFail(true);await Promise.all(Array.from({length:8},()=>f.store.tick({manual:true})));assert.equal(f.restarts,1);await f.reopen();await f.store.tick({manual:true});assert.equal(f.restarts,1);f.advance(300001);await f.store.tick({manual:true});assert.equal(f.restarts,2);await f.reopen();f.advance(300001);assert.equal((await f.store.tick({manual:true})).phase,'backoff');assert.equal(f.restarts,2);f.advance(3600001);await f.store.tick({manual:true});assert.equal(f.restarts,3);
});
test('online, non-native, pending requests and corrupt state cannot trigger an unintended restart',async t=>{
 const f=await fixture(t);await f.store.tick({manual:true});assert.equal(f.restarts,0);f.offline();f.setNative(false);assert.equal((await f.store.tick({manual:true})).phase,'disabled');f.setNative(true);f.setIdle(false);assert.equal((await f.store.tick({manual:true})).phase,'waiting_io');assert.equal(f.restarts,0);f.setIdle(true);await f.corrupt();assert.equal((await f.store.tick({manual:true})).phase,'blocked');assert.equal(f.restarts,0);
});
test('Linux status stays fresh without ever restarting the Mac QQ agent',async t=>{
 const f=await fixture(t);f.setNative(false);assert.equal((await f.store.tick()).online,true);assert.equal(f.store.snapshot().phase,'online');
 f.advance(90000);await f.store.tick();assert.equal(f.store.snapshot().online,true);f.offline();assert.equal((await f.store.tick({manual:true})).online,false);assert.equal(f.restarts,0);
});
