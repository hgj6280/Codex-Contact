import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openQqSendBudget} from './qq-send-budget.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'qq-budget-'));let clock=Date.parse('2026-11-01T12:00:00+08:00'),store=await openQqSendBudget(join(dir,'budget.sqlite'),{now:()=>clock});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {get store(){return store;},advance:n=>clock+=n,async reopen(){store.close();store=await openQqSendBudget(join(dir,'budget.sqlite'),{now:()=>clock});}};}
const account='10011',ok=id=>({status:'ok',retcode:0,data:{message_id:id}});
test('account-wide cap rejects the 2001st submission across many targets and survives restart',async t=>{
  const f=await fixture(t);f.store.update(account,{revision:'initial',dailyLimit:2000,perMinute:60});let calls=0;
  for(let minute=0;minute<40;minute++){for(let i=0;i<50;i++){const id=f.store.reserve(account);calls++;f.store.finish(id,ok(calls));}f.advance(60001);}
  assert.equal(calls,2000);assert.equal(f.store.snapshot(account).remaining,0);assert.throws(()=>f.store.reserve(account),/上限/);assert.throws(()=>f.store.update(account,{...f.store.settings(account),dailyLimit:2001}),/最多2000/);
  await f.reopen();assert.equal(f.store.snapshot(account).used,2000);f.advance(24*3600000);assert.equal(f.store.snapshot(account).used,0);assert.ok(f.store.reserve(account));
});
test('parallel reservations cannot race past minute limits; unknown deliveries remain counted',async t=>{
  const f=await fixture(t),attempts=await Promise.allSettled(Array.from({length:40},async()=>f.store.reserve(account)));assert.equal(attempts.filter(a=>a.status==='fulfilled').length,20);
  const id=attempts.find(a=>a.status==='fulfilled').value;f.store.finish(id,null);await f.reopen();assert.equal(f.store.snapshot(account).used,20);assert.equal(f.store.snapshot(account).uncertain,20);
});
test('native self-message observation and HTTP acknowledgment count the same message once; backfill is idempotent',async t=>{
  const {store}=await fixture(t);const id=store.reserve(account);store.observe({post_type:'message_sent',self_id:account,user_id:account,message_id:1234});assert.equal(store.snapshot(account).used,2);store.finish(id,ok(1234));assert.equal(store.snapshot(account).used,1);store.observe({post_type:'message_sent',self_id:account,user_id:account,message_id:1234});assert.equal(store.snapshot(account).used,1);
  store.seed(account,17);store.seed(account,17);assert.equal(store.snapshot(account).used,18);assert.equal(store.snapshot('10019').used,0);
  const second=store.reserve(account);store.finish(second,ok(1234));assert.equal(store.snapshot(account).used,19,'a reused native message ID must not erase a previous submission');
});
