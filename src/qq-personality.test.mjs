import {promptPart} from './qq-observability.mjs';
import {qqWebFreshnessInstructions,qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources} from './qq-web-lookup.mjs';
import {qqModelPrivacyInstructions,qqModelPrivacyReply,modelPrivacyReply,protectQqModelIdentity} from './qq-model-identity.mjs';
import {finishQqVoiceReply} from './qq-voice-replies.mjs';
import {isLocalTextProvider,isQqHttpTextProvider} from './qq-local-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {openQqPersonality, personalityName, personalityPrompt, handlePersonalityRequest, QQ_PERSONALITY_SNAPSHOT} from './qq-personality.mjs';
import {compactGeminiSoul, buildCompactGeminiPrompt, GEMINI_ROUTER_MODEL, isGeminiTextProvider, useGeminiText} from './qq-text-context.mjs';
import {isLocalChatRequest} from './qq-chat.mjs';
import {bindPersonalityEditor} from '../modules/web-console/public/personality-editor.mjs';
import {limitQqReplyText,qqResponseIntent,QQ_LONG_REPLY_GUIDANCE} from './qq-reply-length.mjs';

const original = '# 狐宫静 SOUL\r\n默认可爱人设 🦊\r\n';
async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'qq-personality-test-'));
  const store = await openQqPersonality({directory, loadDefault:async()=>original, ...options});
  return {directory, store};
}
test('original default is backed up byte-for-byte, never overwritten, and disabled saves retain custom text across restart', async () => {
  const {directory, store} = await fixture();
  const initial = store.snapshot();
  const backup = join(directory, initial.defaultBackupName);
  assert.equal(await readFile(backup,'utf8'), original);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  const custom = '狐宫静现在是安静的图书管理员，只用一句话回答。';
  const enabled = await store.update({...initial, enabled:true, text:custom});
  assert.notEqual(enabled.revision, initial.revision);
  assert.equal((await stat(join(directory,'qq-personality.json'))).mode & 0o777, 0o600);
  const off = await store.update({...enabled, enabled:false});
  assert.equal(off.text, custom);
  assert.match(personalityPrompt(off), /默认可爱人设/);
  assert.doesNotMatch(personalityPrompt(off), /图书管理员/);
  const reopened = await openQqPersonality({directory, loadDefault:()=>assert.fail('Never replace an existing backup')});
  assert.deepEqual(reopened.snapshot(), off);
  assert.equal(await readFile(backup,'utf8'), original);
  assert.equal((await reopened.update(off)).revision, off.revision);
});
test('validation and optimistic concurrency prevent invalid, oversized and stale saves', async () => {
  const {store} = await fixture(); const initial = store.snapshot();
  for (const update of [{enabled:'yes'}, {text:4}, {text:'x'.repeat(8001)}, {enabled:true,text:' '},
    {text:'bad\0value'}, {text:'\ud800'}, {revision:''}])
    await assert.rejects(store.update({...initial,...update}), e=>e.status===400);
  assert.deepEqual(store.snapshot(), initial);
  const attempts = await Promise.allSettled([store.update({...initial,text:'A'}),store.update({...initial,text:'B'})]);
  assert.equal(attempts[0].status,'fulfilled');
  assert.equal(attempts[1].reason.status,409);
  assert.equal(store.snapshot().text,'A');
});
test('failed disk save does not publish a new personality or poison subsequent saves', async () => {
  let failing = true;
  const {store} = await fixture({persist:async()=>{if(failing)throw new Error('disk full');}});
  const initial = store.snapshot();
  await assert.rejects(store.update({...initial,enabled:true,text:'改变'}), /disk full/);
  assert.deepEqual(store.snapshot(),initial);
  failing=false;
  assert.equal((await store.update({...initial,enabled:true,text:'改变'})).text,'改变');
});
test('custom persona remains complete even in Gemini compact mode, with permissions independent', () => {
  const text='# 自定义\n## 语气示例\n'+'非常重要 🦊 '.repeat(250)+'\n结尾规则必须保留';
  const profile={enabled:true,text,defaultText:original};
  const prompt=personalityPrompt(profile,{compact:true,compressDefault:compactGeminiSoul});
  assert.ok(prompt.includes(text));assert.match(prompt,/不能改变隐私、权限/);
  assert.ok(buildCompactGeminiPrompt({instructions:prompt,text:'你好'}).includes(text));
});
test('local personality endpoints enforce access, size cap, conflict status and real default download', async () => {
  const {store} = await fixture();
  async function request(method,url,body,headers={host:'127.0.0.1:3789'}) {
    let result={},limit;
    const res={writeHead(status,headers){result={status,headers};},end(body){result.body=body;}};
    const handled=await handlePersonalityRequest({method,url,headers},res,{store,isLocalRequest:isLocalChatRequest,
      readBody:async(_req,max)=>{limit=max;return body;},sendJson:(_res,status,body)=>{result={status,body};}});
    return {...result,handled,limit};
  }
  const current=await request('GET','/api/qq/personality');assert.equal(current.status,200);
  const saved=await request('POST','/api/qq/personality',{...current.body,enabled:true,text:'自定义'});
  assert.equal(saved.status,200);assert.equal(saved.limit,65536);
  assert.equal((await request('POST','/api/qq/personality',current.body)).status,409);
  for(const headers of [{host:'evil.test'}, {host:'127.0.0.1:3789',origin:'https://evil.test'},
    {host:'127.0.0.1:3789','sec-fetch-site':'cross-site'}])
    assert.equal((await request('GET','/api/qq/personality',null,headers)).status,403);
  const backup=await request('GET','/api/qq/personality/default');
  assert.equal(backup.body,original);assert.match(backup.headers['content-disposition'],/attachment/);
  assert.equal((await request('DELETE','/api/qq/personality')).status,405);
  assert.equal((await request('GET','/api/qq/unrelated')).handled,false);
});
test('real server instructions use same snapshot for group/private and Codex/Gemini, without overriding custom length', async () => {
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('async function buildAssistantInstructions('),end=source.indexOf('async function loadAssistantSkillBrief()',start);
  const {store}=await fixture(); await store.update({...store.snapshot(),enabled:true,text:'身份仍为狐宫静；严肃简洁，每次只回复一句。不加括号动作。'});
  const sandbox={personalityName,assistantName:'助手',qqLife:null,qqWebFreshnessInstructions,qqModelPrivacyInstructions,qqModelPrivacyReply,modelPrivacyReply,qqPersonality:store,personalityPrompt,compactGeminiSoul,QQ_PERSONALITY_SNAPSHOT,ownerLabel:'管理员',buildActionExamples:()=> '默认动作',
    roleplayActive:()=>false,state:{qq:{enhancer:{enabled:false}}}};
  for(const type of ['private_message','group_message'])for(const compact of [false,true]) {
    const event={type,senderLabel:'测试用户'};
    const prompt=await vm.runInNewContext(source.slice(start,end)+'\nbuildAssistantInstructions(event,{compact})',{...sandbox,event,compact});
    assert.match(prompt,/严肃简洁，每次只回复一句/);assert.doesNotMatch(prompt,/80 到 180 字|80–180字|默认动作|软萌狐娘语气/);
    assert.match(prompt,/不透露本机路径|不要泄露本机路径/);
    assert.equal(event[QQ_PERSONALITY_SNAPSHOT].revision,store.snapshot().revision);
    assert.doesNotMatch(JSON.stringify(event),/严肃简洁|qqPersonality|defaultText/);
    const oldRevision=event[QQ_PERSONALITY_SNAPSHOT].revision;
    await store.update({...store.snapshot(),text:store.snapshot().text+' 新设定'});
    await vm.runInNewContext(source.slice(start,end)+'\nbuildAssistantInstructions(event,{compact})',{...sandbox,event,compact});
    assert.equal(event[QQ_PERSONALITY_SNAPSHOT].revision,oldRevision); // In-flight requests stay consistent.
  }
});
test('stateless Gemini router receives the current personality every time, without browser session carry-over', async () => {
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('async function buildModelReply(event)'),end=source.indexOf('function limitQqStickerFrequency',start);
  const keys=[];
  const sandbox={
      promptPart,
      currentQqName:()=> '测试角色',isLocalTextProvider,isQqHttpTextProvider,qqResponseIntent,QQ_LONG_REPLY_GUIDANCE,protectQqModelIdentity,finishQqVoiceReply,qqLife:null,qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources,useGeminiText,GEMINI_ROUTER_MODEL,isGeminiTextProvider,buildCompactGeminiPrompt,QQ_PERSONALITY_SNAPSHOT,limitQqReplyText,
    state:{ai:{qqReplyProvider:GEMINI_ROUTER_MODEL,model:'gpt-6-luna'},qq:{enhancer:{enabled:false}}},
    stripMentionText:t=>t,isImageGenerationRequest:()=>false,hasAnyQqImageReference:()=>false,getQqModelImageInputs:()=>[],
    join:(...v)=>v.join('/'),crypto:{randomUUID:()=> 'id'},codexTmpDir:'/tmp',qqGeneratedArchiveDir:'/archive',dataDir:'/data',qqStickerDir:'/stickers',qqCharacterDir:'/oc',
    formatQuotedContext:()=>'',formatMemoryContext:()=>'',formatQqPersonaContext:()=>'',buildWebLookupContext:async()=>'',
    buildQqStickerCatalog:async()=>[],loadQqCharacter:async()=>({prompt:'OC',imagePaths:[]}),selectQqImageModel:()=> 'gpt-6-luna',
    buildAssistantInstructions:async event=> '人设版本 '+event[QQ_PERSONALITY_SNAPSHOT].revision,formatQqStickerCatalog:()=>'',
    geminiRouterReply:async prompt=>{keys.push(prompt);return {text:'你好',usage:{available:true},durationMs:1};},
    cleanCodexReply:t=>t,shouldRequestExpandedQqContext:()=>false,limitQqStickerFrequency:t=>t};
  for(const revision of ['a','a','b'])await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',{
    ...sandbox,event:{text:'你好',type:'group_message',groupId:'20010',[QQ_PERSONALITY_SNAPSHOT]:{revision}}});
  assert.equal(keys[0],keys[1]);assert.notEqual(keys[0],keys[2]);
  assert.match(keys[2],/人设版本 b/);assert.doesNotMatch(keys[2],/人设版本 a/);
});

function fakeEditor(api) {
  const nodes = new Map();
  const root={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',checked:false,textContent:'',
    addEventListener(name,handler){this[name]=handler;}});return nodes.get(selector);}};
  return {editor:bindPersonalityEditor({root,api}),get:name=>nodes.get(`[data-personality-${name}]`)};
}
test('editor preserves unsaved typing, toggles only saved text, and reports conflicts without losing edits', async () => {
  const {store}=await fixture();let writes=0;
  const {editor,get}=fakeEditor(async(_path,body)=>body?(writes++,store.update(body)):store.snapshot());
  await editor.load();get('text').value='手动修改';get('text').input();
  await editor.load();assert.equal(get('text').value,'手动修改');
  get('toggle').checked=true;get('toggle').change();
  assert.equal(get('toggle').checked,false);assert.equal(writes,0);
  await get('save').click();assert.equal(store.snapshot().text,'手动修改');assert.equal(store.snapshot().enabled,false);
  get('toggle').checked=true;await get('toggle').change();
  assert.equal(store.snapshot().enabled,true);
  await store.update({...store.snapshot(),text:'其他页面修改'});
  get('text').value='本页不丢失';get('text').input();await get('save').click();
  assert.equal(get('text').value,'本页不丢失');assert.match(get('status').textContent,/其他页面更新/);
});
test('in-flight save does not overwrite typing made while the request is pending', async () => {
  const {store}=await fixture();let release;
  const {editor,get}=fakeEditor(async(_path,body)=>{
    if(!body)return store.snapshot();await new Promise(resolve=>release=resolve);return store.update(body);
  });
  await editor.load();get('text').value='第一版';get('text').input();const saving=get('save').click();
  get('text').value='第二版未保存';get('text').input();release();await saving;
  assert.equal(store.snapshot().text,'第一版');assert.equal(get('text').value,'第二版未保存');assert.match(get('status').textContent,/还有未保存/);
});
test('role name derives from old profile text, explicit name wins, persists and never edits the persona text',async()=>{
 const {store,directory}=await fixture();const text='你是猫夕岚，温柔的成年猫娘。日常自然聊天。';
 await store.update({...store.snapshot(),enabled:true,text});assert.equal(store.snapshot().effectiveName,'猫夕岚');assert.equal(store.snapshot().text,text);
 await store.update({...store.snapshot(),name:'小岚'});assert.equal(store.snapshot().effectiveName,'小岚');assert.equal(store.snapshot().text,text);assert.match(personalityPrompt(store.snapshot()),/当前有效角色名：小岚/);
 const reopened=await openQqPersonality({directory,loadDefault:async()=>original});assert.equal(reopened.snapshot().effectiveName,'小岚');
 await assert.rejects(store.update({...store.snapshot(),name:'坏\n名字'}));
 const {name,...legacy}=store.snapshot();await store.update({...legacy,text:text+' 喜欢安静。'});assert.equal(store.snapshot().name,'小岚');
});
test('rename history follows arbitrary role switches and derives the original SOUL name without modifying it',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'qq-name-switch-'));const store=await openQqPersonality({directory,loadDefault:async()=> '你的角色名字是“狐宫静”，自然聊天。'});
 await store.update({...store.snapshot(),enabled:true,text:'你是猫夕岚，日常自然聊天。'});assert.equal(store.snapshot().effectiveName,'猫夕岚');assert.ok(store.snapshot().previousNames.includes('狐宫静'));
 await store.update({...store.snapshot(),name:'栀夏'});assert.ok(store.snapshot().previousNames.includes('猫夕岚'));assert.equal(store.snapshot().effectiveName,'栀夏');
 await store.update({...store.snapshot(),name:'猫夕岚'});assert.ok(store.snapshot().previousNames.includes('栀夏'));assert.ok(!store.snapshot().previousNames.includes('猫夕岚'));
});
