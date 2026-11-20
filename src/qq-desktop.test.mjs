import test from 'node:test';
import {GEMINI_ROUTER_MODEL, isGeminiTextProvider} from './qq-text-context.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {safeMediaUrl,recipient,pollDelay,unreadCount,compactTokens,avatarInitial} from '../modules/web-console/public/desktop-state.mjs';
test('desktop routes recipients explicitly and refuses unsafe image URLs',()=>{
  assert.deepEqual(recipient('20001'),{groupId:'20001'});
  assert.deepEqual(recipient('private:10002'),{userId:'10002'});
  assert.throws(()=>recipient('../20004'));
  for(const url of ['file:///etc/passwd','javascript:alert(1)','https://foreign.test/x','http://gchat.qpic.cn/x','/api/qq/chat-media/../settings.json'])assert.equal(safeMediaUrl(url),null);
  assert.equal(safeMediaUrl('https://gchat.qpic.cn/x'),'https://gchat.qpic.cn/x');
  const url='/api/qq/chat-media/'+ 'a'.repeat(64)+'.png';assert.equal(safeMediaUrl(url),url);
});
test('background polls slow down and notifications do not invent unread counts',()=>{
  assert.equal(pollDelay(true,true),2000);assert.equal(pollDelay(false,true),15000);assert.equal(pollDelay(true,false),15000);
  assert.equal(unreadCount({id:'a',lastId:'2'},{a:'1'}),1);assert.equal(unreadCount({id:'a',lastId:'2'},{}),0);
  assert.equal(compactTokens(1500),'1.5K');assert.equal(compactTokens(1230000),'1.23M');
  assert.equal(avatarInitial('🥦群友'),'🥦');assert.equal(avatarInitial('👨‍👩‍👧‍👦朋友'),'👨‍👩‍👧‍👦');
});
test('desktop controls exist and the page has no external script, inline code or unsafe rendering',async()=>{
  const html=await readFile(new URL('../modules/web-console/public/desktop.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../modules/web-console/public/desktop.js',import.meta.url),'utf8');
  const other=await Promise.all(['desktop-management.mjs','desktop-mentions.mjs'].map(n=>readFile(new URL('../modules/web-console/public/'+n,import.meta.url),'utf8')));
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  for(const source of [js,...other]){for(const match of source.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(match[1]),`missing control ${match[1]}`);assert.doesNotMatch(source,/innerHTML|eval\(/);}
  assert.match(html,/script-src 'self'/);assert.doesNotMatch(html,/<script[^>]+src="https?:/);
  assert.doesNotMatch(js,/innerHTML|eval\(/);assert.match(js,/s\.usage\?\.total/);
});

test('production polling still checks QQ login when conversations or preview refresh fail',async()=>{
  const source=await readFile(new URL('../modules/web-console/public/desktop.js',import.meta.url),'utf8');
  const poll=source.slice(source.indexOf('async function poll(){'),source.indexOf("document.addEventListener('visibilitychange'"));
  let checked=0,warnings=0,scheduled=0;
  const context=createContext({timer:null,polling:false,connected:true,desktopState:{online:true},document:{hidden:false},active:true,
    clearTimeout(){},setTimeout(){scheduled++;},pollDelay:()=>2000,
    refreshConversations:async()=>{throw new Error('conversation timeout');},refreshMessages:async()=>{},refreshJobs:async()=>{throw new Error('preview timeout');},
    refreshState:async()=>{checked++;},console:{warn(){warnings++;}}});
  runInContext(poll,context);await context.poll();
  assert.equal(checked,1);assert.equal(context.connected,true);assert.equal(warnings,2);assert.equal(context.polling,false);assert.equal(scheduled,1);
});

test('production login UI distinguishes unknown from offline and restores send controls',async()=>{
  const source=await readFile(new URL('../modules/web-console/public/desktop.js',import.meta.url),'utf8');
  const composer=source.slice(source.indexOf('function updateComposer(){'),source.indexOf("$('input').oninput="));
  const status=source.slice(source.indexOf('function renderConnection(){'),source.indexOf("$('model').onchange="));
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='input'?'unsent draft':'',dataset:{},textContent:'',classList:{toggle(){}}});return nodes.get(id);};
  let response={online:true,model:'gpt-6-luna',account:{id:'10001',name:'测试助手'},aiEnabled:true},fail=false;
  const context=createContext({$,fastModeEditor:{update(){}},imageModelEditor:{update(){}},conversationAi:{update(){}},selected:'20001',sending:false,connected:null,attachment:null,mentions:{ids:()=>[]},desktopState:null,
    document:{activeElement:null},compactTokens:String,api:async()=>{if(fail)throw new Error('status timeout');return response;}});
  runInContext(composer+status,context);
  await context.refreshState();assert.equal($('connection').textContent,'QQ 在线');assert.equal($('send').disabled,false);
  fail=true;await assert.rejects(context.refreshState(),/timeout/);assert.equal(context.connected,null);assert.equal($('connection').textContent,'连接待确认');assert.equal($('send').disabled,false);
  fail=false;response={...response,online:false};await context.refreshState();assert.equal($('connection').textContent,'QQ 离线');assert.equal($('send').disabled,true);
  response={...response,online:true};await context.refreshState();assert.equal($('connection').textContent,'QQ 在线');assert.equal($('send').disabled,false);assert.equal($('hint').textContent,'Enter 发送 · Shift+Enter 换行');assert.equal($('input').value,'unsent draft');
});

test('production backend does not call a missing QQ status offline',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const status=source.slice(source.indexOf('let desktopStatusCache='),source.indexOf('const seenMessageTtlMs'));
  for(const online of [true,false,null]){
    const context=createContext({currentQqName:()=>'测试角色',isQqHttpTextProvider:()=>false,qqGroupDigest:null,qqVoiceFollowups:{snapshot:()=>({})},GEMINI_ROUTER_MODEL,isGeminiTextProvider,oneBotApiBase:'http://bridge',AbortSignal,state:{channels:{qq:true},ai:{model:'gpt-6-luna',reasoningEffort:'low'}},
      qqPublicModelName:'GPT-6 Astra',qqFastModeSettings:{snapshot:()=>({enabled:false,revision:'fast-0'})},qqImageModelSettings:{snapshot:()=>({provider:'nano-banana-2',fallbackToGpt:true})},qqConversationAiSettings:{snapshot:()=>({disabledConversations:[]})},selectQqImageModel:()=> 'gpt-6-sol',qqUsageLedger:{snapshot:()=>({})},desktopDrafts:{active:()=>0},
      bridgeFetch:async url=>{if(url.endsWith('get_status')&&online===null)throw new Error('timeout');return {json:async()=>({status:'ok',data:url.endsWith('get_status')?{online}:{user_id:10001,nickname:'测试助手'}})};}});
    runInContext(status,context);assert.equal((await context.desktopStatus()).online,online);
  }
});

test('cancelled background message reads preserve existing bubbles and do not repeatedly toast',async()=>{
  const source=await readFile(new URL('../modules/web-console/public/desktop.js',import.meta.url),'utf8');
  const refresh=source.slice(source.indexOf('async function refreshMessages('),source.indexOf('function updateComposer(){'));
  let toasts=0,renders=0;const original=[{id:'keep-this-bubble'}];
  const context=createContext({selected:'20001',messages:original,messageFailures:new Map(),messageTags:new Map(),messageCaches:new Map(),conversations:[],
    cached:async()=>{throw Object.assign(Error('Fetch is aborted'),{code:'ABORT'});},notice:()=>toasts++,renderMessages:()=>renders++,console:{warn(){}}});
  runInContext(refresh,context);await context.refreshMessages();await context.refreshMessages();
  assert.equal(context.messages,original);assert.equal(toasts,0);assert.equal(renders,0);assert.equal(context.messageFailures.get('20001'),'ABORT');
  context.messages=[];await context.refreshMessages();assert.equal(renders,1);
});
