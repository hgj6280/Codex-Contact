import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopTransport,createChatImageLoader} from '../modules/web-console/public/desktop-transport.mjs';
const response=(data,status=200)=>({status,ok:status<400,headers:new Headers({etag:'"v1"'}),json:async()=>data});
const abort=()=>Object.assign(new Error('Fetch is aborted'),{name:'AbortError'});
test('identical reads share one request and cancelled reads retry once, writes never retry',async()=>{
  let calls=0,release;const events=[];
  const t=createDesktopTransport({onEvent:e=>events.push(e),fetchImpl:async()=>{calls++;if(calls===1)throw abort();await new Promise(r=>release=r);return response({online:true});}});
  const first=t.api('/desktop-state'),second=t.api('/desktop-state');await new Promise(setImmediate);release();
  assert.deepEqual(await first,{online:true});assert.deepEqual(await second,{online:true});assert.equal(calls,2);assert.equal(events[0].error,'ABORT');
  let writes=0;const w=createDesktopTransport({fetchImpl:async()=>{writes++;throw abort();}});
  await assert.rejects(w.api('/send',{text:'not actually sent'}),e=>e.code==='ABORT'&&!e.message.includes('Fetch is aborted'));assert.equal(writes,1);
});
test('read concurrency is bounded and status checks have queue priority',async()=>{
  const order=[],releases=[];let active=0,peak=0;
  const t=createDesktopTransport({readLimit:1,fetchImpl:async path=>{order.push(path);peak=Math.max(peak,++active);await new Promise(r=>releases.push(r));active--;return response({});}});
  const a=t.api('/first'),b=t.api('/chat/123456'),c=t.api('/desktop-state');await new Promise(setImmediate);releases.shift()();await a;await new Promise(setImmediate);
  assert.deepEqual(order,['/first','/desktop-state']);releases.shift()();await c;await new Promise(setImmediate);releases.shift()();await b;assert.equal(peak,1);
});
test('explicit timeout covers response body; HTTP failures and invalid JSON do not retry',async()=>{
  let tries=0;const t=createDesktopTransport({readTimeout:5,fetchImpl:async(_p,{signal})=>{tries++;return {...response({}),json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(abort())))};}});
  await assert.rejects(t.api('/chat'),e=>e.code==='TIMEOUT');assert.equal(tries,2);
  let calls=0;const h=createDesktopTransport({fetchImpl:async()=>{calls++;return response({error:'没有权限'},403);}});
  await assert.rejects(h.api('/chat'),e=>e.status===403);assert.equal(calls,1);
  const invalid=createDesktopTransport({fetchImpl:async()=>({...response({}),json:async()=>{throw new SyntaxError('bad json');}})});
  await assert.rejects(invalid.api('/chat'),e=>e.code==='INVALID_JSON');
});
test('ETag reads preserve 304 and telemetry failures cannot abort a successful request',async()=>{
  const t=createDesktopTransport({onEvent:()=>{throw Error('telemetry failed');},fetchImpl:async(_p,init)=>response({tag:init.headers['if-none-match']},init.headers['if-none-match']?304:200)});
  assert.equal(await t.cached('/chat','"v1"'),null);assert.deepEqual((await t.cached('/chat')).data,{tag:undefined});
});
test('chat images occupy only two slots, queued stale images are pruned and failure releases a slot',()=>{
  const make=()=>({isConnected:true,src:'',removeAttribute(){this.src='';}}),a=make(),b=make(),c=make(),d=make();let failed=0;
  const q=createChatImageLoader({Observer:null,limit:2});q.add(a,'a');q.add(b,'b');q.add(c,'c');q.add(d,'d');
  assert.equal(a.src,'a');assert.equal(b.src,'b');assert.equal(c.src,'');a.onload();assert.equal(c.src,'c');
  b.isConnected=false;d.isConnected=false;q.prune();assert.equal(b.src,'');assert.equal(d.src,'');c.onload();
  q.add(a,'a-again',()=>{},()=>failed++);a.onerror();assert.equal(failed,1);
});
