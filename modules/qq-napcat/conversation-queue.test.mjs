import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {createConversationQueue} from './conversation-queue.mjs';
test('different chats run concurrently; same chat stays ordered; limit is retained', async () => {
  const q = createConversationQueue({concurrency:2,limit:3});
  const started=[];let release;
  const gate=new Promise(r=>{release=r;});
  q.add('a',async()=>{started.push('a1');await gate;});
  q.add('a',async()=>{started.push('a2');});
  q.add('b',async()=>{started.push('b1');await gate;});
  assert.equal(q.add('c',()=>{}),false);
  await tick();assert.deepEqual(started,['a1','b1']);assert.equal(q.active,2);
  release();await tick();await tick();assert.deepEqual(started,['a1','b1','a2']);assert.equal(q.size,0);
});
test('failed jobs do not block following messages',async()=>{
  let errors=0;let next=false;
  const q=createConversationQueue({onError:()=>{errors++;}});
  q.add('a',()=>{throw Error('test');});q.add('a',()=>{next=true;});
  await tick();await tick();assert.equal(errors,1);assert.equal(next,true);assert.equal(q.size,0);
});
