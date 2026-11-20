import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFastModeSettings,handleFastModeRequest} from './qq-fast-mode.mjs';
import {bindFastModeToggle} from '../modules/web-console/public/fast-mode-editor.mjs';
import {openUsageLedger} from './qq-usage.mjs';
import {estimateTokenCost} from './qq-token-pricing.mjs';

test('default is off; toggles serialize, stale pages fail and save failures retain saved state',async()=>{
  let enabled=false,fail=false;
  const store=createFastModeSettings({read:()=>enabled,write:async value=>{if(fail)throw new Error('disk');enabled=value;}});
  assert.deepEqual(store.snapshot(),{enabled:false,revision:'fast-0'});
  await store.update({enabled:true,revision:'fast-0'});assert.equal(store.snapshot().enabled,true);
  await assert.rejects(store.update({enabled:false,revision:'fast-0'}),e=>e.status===409);
  await assert.rejects(store.update({enabled:'true',revision:'fast-1'}),e=>e.status===400);
  fail=true;await assert.rejects(store.update({enabled:false,revision:'fast-1'}),/disk/);assert.equal(store.snapshot().enabled,true);
  fail=false;await store.update({enabled:false,revision:'fast-1'});assert.equal(enabled,false);
});

test('local API saves the boolean only and rejects remote and stale writes',async()=>{
  let enabled=false;const store=createFastModeSettings({read:()=>enabled,write:async v=>enabled=v});
  const request=async(method,body,local=true)=>{let response;await handleFastModeRequest({url:'/api/qq/fast-mode',method},{},{store,isLocalRequest:()=>local,readBody:async()=>body,sendJson:(_r,status,data)=>response={status,data}});return response;};
  assert.equal((await request('POST',{enabled:true,revision:'fast-0'},false)).status,403);assert.equal(enabled,false);
  assert.equal((await request('GET')).data.enabled,false);
  assert.equal((await request('POST',{enabled:true,revision:'fast-0'})).status,200);assert.equal(enabled,true);
  assert.equal((await request('POST',{enabled:false,revision:'fast-0'})).status,409);
});

test('checkbox is guarded during saving, restores failures, and background polling cannot overwrite the pending choice',async()=>{
  const elements=Object.fromEntries(['toggle','status'].map(k=>[k,{checked:false,disabled:false,textContent:'',listeners:{},addEventListener(t,fn){this.listeners[t]=fn;}}]));
  let resolve,reject;const editor=bindFastModeToggle({root:{querySelector:s=>elements[s.includes('toggle')?'toggle':'status']},api:(_p,body)=>body?new Promise((r,j)=>{resolve=r;reject=j;}):Promise.resolve({enabled:false,revision:'fast-0'})});
  await editor.load();elements.toggle.checked=true;const pending=elements.toggle.listeners.change();
  editor.update({enabled:false,revision:'fast-0'});assert.equal(elements.toggle.checked,true);assert.equal(elements.toggle.disabled,true);
  resolve({enabled:true,revision:'fast-1'});await pending;assert.equal(elements.toggle.checked,true);
  elements.toggle.checked=false;const failed=elements.toggle.listeners.change();reject(new Error('disk'));await failed;assert.match(elements.status.textContent,/保存失败/);assert.equal(elements.toggle.disabled,false);
});

test('fast cost estimates are tier-aware, persisted, and actual returned standard tier overrides requested fast',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-fast-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const usage={input_tokens:1000,cached_input_tokens:500,output_tokens:100};const normalized={inputTokens:1000,cachedInputTokens:500,outputTokens:100};
  const standard=estimateTokenCost('gpt-6-luna',normalized),ledger=await openUsageLedger(dir);
  const a=ledger.start('gpt-6-luna',{serviceTier:'fast'});a.write(JSON.stringify({type:'turn.completed',usage}));await a.finish('completed');
  assert.equal(ledger.snapshot().total.estimatedUsd,standard*2);
  const b=ledger.start('gpt-6-luna',{serviceTier:'fast'});b.write(JSON.stringify({type:'turn.completed',usage,service_tier:'default'}));await b.finish('completed');
  assert.equal(ledger.snapshot().total.estimatedUsd,standard*3);assert.deepEqual((await openUsageLedger(dir)).snapshot(),ledger.snapshot());
  assert.equal(estimateTokenCost('gpt-6-luna',normalized,{serviceTier:'unknown'}),null);
});

test('CLI fast flags are added before image-task argument cloning without changing model or reasoning',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('  const useFastMode = state.ai.qqFastMode');const end=source.indexOf('  const validationReport =',start);
  const chunk=source.slice(start,end);assert.match(chunk,/features.fast_mode=true/);assert.match(chunk,/service_tier="fast"/);assert.match(chunk,/model_reasoning_effort/);assert.match(chunk,/replyModel/);
  assert.ok(source.indexOf('if (useGeminiText(')<start);
  for(const page of ['desktop.html','client.html'])assert.match(await readFile(new URL('../modules/web-console/public/'+page,import.meta.url),'utf8'),/data-fast-mode-toggle/);
});
