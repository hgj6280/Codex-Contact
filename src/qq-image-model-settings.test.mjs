import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createImageModelSettings,handleImageModelRequest} from './qq-image-model-settings.mjs';
import {bindImageModelEditor} from '../modules/web-console/public/image-model-editor.mjs';

test('image selection is serialized, rejects stale pages and preserves settings when save fails',async()=>{
  let saved={provider:'nano-banana-2',fallbackToGpt:false},fail=false;
  const store=createImageModelSettings({read:()=>saved,gptModel:()=> 'gpt-6-luna',write:async next=>{if(fail)throw Error('disk');saved=next;}});
  const initial=store.snapshot();await store.update({...initial,fallbackToGpt:true});
  assert.equal(store.snapshot().fallbackToGpt,true);
  await assert.rejects(store.update({...initial,provider:'codex-cli'}),e=>e.status===409);
  await assert.rejects(store.update({...store.snapshot(),provider:'foreign-api'}),e=>e.status===400);
  fail=true;await assert.rejects(store.update({...store.snapshot(),provider:'codex-cli'}),/disk/);assert.equal(store.snapshot().provider,'nano-banana-2');
  fail=false;await store.update({...store.snapshot(),provider:'codex-cli'});assert.equal(store.snapshot().model,'gpt-6-luna');
});
test('image-model API is local-only and does not change the text reply model',async()=>{
  let saved={provider:'nano-banana-2',fallbackToGpt:true};const text='gemini-3.8flash';
  const store=createImageModelSettings({read:()=>saved,gptModel:()=> 'gpt-6-luna',write:async next=>saved=next});
  const request=async(method,body,local=true)=>{let result;await handleImageModelRequest({url:'/api/qq/image-model',method},{},{store,isLocalRequest:()=>local,readBody:async()=>body,sendJson:(_r,status,data)=>result={status,data}});return result;};
  assert.equal((await request('POST',{},false)).status,403);
  const before=await request('GET');assert.equal(before.data.provider,'nano-banana-2');
  assert.equal((await request('POST',{...before.data,provider:'codex-cli'})).status,200);
  assert.equal(saved.provider,'codex-cli');assert.equal(text,'gemini-3.8flash');
});
function editorFixture(api){
  const elements=Object.fromEntries(['provider','fallback','save','status'].map(k=>[k,{value:'',checked:false,disabled:false,textContent:'',listeners:{},addEventListener(t,f){this.listeners[t]=f;}}]));
  const editor=bindImageModelEditor({root:{querySelector:s=>elements[s.includes('provider')?'provider':s.includes('fallback')?'fallback':s.includes('save')?'save':'status']},api});
  return {elements,editor};
}
test('image controls protect pending edits from polls and keep a failed save retryable',async()=>{
  const base={provider:'nano-banana-2',fallbackToGpt:true,revision:'initial',gptModel:'gpt-6-luna'};
  let resolve,reject,body;const {elements:e,editor}=editorFixture(async(_p,b)=>b?(body=b,await new Promise((r,j)=>{resolve=r;reject=j;})):base);
  await editor.load();assert.equal(e.fallback.checked,true);e.provider.value='codex-cli';e.provider.listeners.change();
  editor.update(base);assert.equal(e.provider.value,'codex-cli');assert.equal(e.fallback.disabled,true);
  const saving=e.save.listeners.click();editor.update(base);assert.equal(e.provider.disabled,true);assert.equal(body.provider,'codex-cli');
  resolve({...base,provider:'codex-cli',revision:'new'});await saving;assert.equal(e.save.disabled,true);assert.match(e.status.textContent,/已选 GPT/);
  e.provider.value='nano-banana-2';e.provider.listeners.change();const failed=e.save.listeners.click();reject(Error('disk'));await failed;
  assert.equal(e.provider.disabled,false);assert.equal(e.save.disabled,false);assert.match(e.status.textContent,/保存失败/);
});
test('both desktop and management pages expose accessible image-only model controls',async()=>{
  for(const page of ['desktop.html','client.html']){
    const html=await readFile(new URL('../modules/web-console/public/'+page,import.meta.url),'utf8');
    for(const name of ['provider','fallback','save','status'])assert.ok(html.includes('data-image-'+name));
    assert.match(html,/Gemini（Nano Banana 2）/);assert.match(html,/GPT（Codex）/);
  }
});
