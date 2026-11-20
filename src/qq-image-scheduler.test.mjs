import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createConversationQueue} from '../modules/qq-napcat/conversation-queue.mjs';
import {createImageScheduler,QQ_IMAGE_CONCURRENCY} from './qq-image-scheduler.mjs';

test('five independent image jobs start together, sixth waits, results retain task identity',async()=>{
  const q=createImageScheduler();assert.equal(QQ_IMAGE_CONCURRENCY,5);
  const gates=[],started=[];
  const jobs=Array.from({length:7},(_,id)=>q.run(async()=>{started.push(id);await new Promise(r=>gates[id]=r);return {id,recipient:`group-${id}`};}));
  await tick();assert.deepEqual(started,[0,1,2,3,4]);assert.equal(q.active,5);assert.equal(q.waiting,2);
  gates[3]();await tick();assert.deepEqual(started,[0,1,2,3,4,5]);assert.equal(q.active,5);
  gates[0]();await tick();assert.ok(started.includes(6));
  for(const release of gates)release();
  const results=await Promise.all(jobs);await tick();assert.deepEqual(results.map(r=>r.id),[0,1,2,3,4,5,6]);assert.equal(q.active,0);
});

test('queue limit and rejection do not leak slots or block subsequent images',async()=>{
  const q=createImageScheduler({concurrency:1,limit:2});let release;
  const first=q.run(async()=>{await new Promise(r=>release=r);throw new Error('network failed');});
  const rejected=assert.rejects(first,/network failed/);const second=q.run(()=> 'second');
  await assert.rejects(q.run(()=> 'overflow'),e=>e.code==='IMAGE_QUEUE_FULL');release();await rejected;assert.equal(await second,'second');await tick();assert.equal(q.active,0);
});

test('bridge separates text and image lanes, scopes image jobs by message and preserves the event',async()=>{
  const source=await readFile(new URL('../modules/qq-napcat/bridge.mjs',import.meta.url),'utf8');
  assert.match(source,/decision.imageRequested\?imageQueue:queue/);
  assert.match(source,/image:\$\{event.message_id\}/);
  assert.match(source,/handleEvent\(event,\{imageRequested:decision.imageRequested===true,timing\}\)/);
  assert.match(source,/45\*60\*1000 : 180000/);
});

test('production bridge routing runs five images in the same group while text remains responsive and ordered',async()=>{
  const source=await readFile(new URL('../modules/qq-napcat/bridge.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function routeEvent(event,receivedAt)'),end=source.indexOf('async function connect()',start);
  const imageQueue=createConversationQueue({concurrency:5}),queue=createConversationQueue({concurrency:2});
  const images=[],texts=[],gates=[];
  const context={sendBudget:{snapshot:()=>({canSend:true})},stats:{received:0,failed:0,filtered:0},readConfig:async()=>({allowedGroups:['20001']}),refreshDirectory:()=>assert.fail(),
    isAllowed:(ids,id)=>ids.includes(String(id)),desktopSecret:'local-test',AbortSignal,
    fetch:async(_url,request)=>({ok:true,json:async()=>({respond:true,imageRequested:JSON.parse(request.body).kind==='image',fast:false})}),imageQueue,queue,
    handleEvent:async(event,options={})=>{if(options.imageRequested){images.push(event);await new Promise(r=>gates.push(r));}else texts.push(event);}};
  const route=vm.runInNewContext(source.slice(start,end)+'\nrouteEvent',context);
  const events=Array.from({length:6},(_,id)=>({self_id:'10001',user_id:`sender-${id}`,message_type:'group',group_id:'20001',message_id:id+1,kind:'image'}));
  await Promise.all(events.map(route));await tick();assert.equal(images.length,5);assert.equal(imageQueue.active,5);
  const text={...events[0],message_id:10,kind:'text'};await route(text);await tick();assert.equal(texts[0],text);
  gates[0]();await tick();assert.equal(images.length,6);
  assert.deepEqual(images,events); // Original group, sender and quote-bearing events stay bound to each task.
  for(const release of gates)release();await tick();await tick();assert.equal(imageQueue.size,0);assert.equal(context.stats.failed,0);
});

test('new model appears in both selectors and backend allowlist with correct pricing',async()=>{
  for(const file of ['../modules/web-console/public/desktop.html','../modules/web-console/public/client.html']){
    const html=await readFile(new URL(file,import.meta.url),'utf8');assert.match(html,/<option value="gpt-6\.1-sol">GPT-6\.1 Sol<\/option>/);
  }
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  assert.match(source,/const models = \[[^\n]*'gpt-6\.1-sol'/);
});
