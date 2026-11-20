import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const publicFile=name=>readFile(new URL('../modules/web-console/public/'+name,import.meta.url),'utf8');
test('tools use a separate track, navigation has labels and removed miniapp entry cannot be invoked',async()=>{
  const [html,css,js,native]=await Promise.all([publicFile('desktop.html'),publicFile('desktop.css'),publicFile('desktop.js'),readFile(new URL('../modules/qq-desktop/QQFriendDesktop.swift',import.meta.url),'utf8')]);
  for(const name of ['聊天','好友','AI 创作','设置'])assert.ok(html.includes(`class="rail-label">${name}`));
  assert.match(css,/\.drawer\{position:static;width:auto/);
  assert.match(css,/:has\(>\.drawer:not\(\[hidden\]\)\).*grid-template-columns/);
  assert.match(css,/>\.sessions\{display:none\}/);
  for(const source of [html,js,native])assert.doesNotMatch(source,/navApps|appsPanel|openQQ/);
  assert.match(native,/后台暂未连接/);assert.doesNotMatch(native,/loadFileURL/);
});
test('inactive UI only checks connection; foreground catches up and bounded caches refetch evicted chats',async()=>{
  const js=await publicFile('desktop.js');
  const source=js.slice(js.indexOf('async function poll(){'),js.indexOf("document.addEventListener('visibilitychange'"));
  const calls=[];
  const context={timer:null,polling:false,active:false,document:{hidden:false},desktopState:{},connected:true,
    clearTimeout(){},setTimeout(){},Date,console,refreshConversations:async()=>calls.push('list'),refreshMessages:async()=>calls.push('messages'),refreshJobs:async()=>calls.push('drafts'),refreshState:async()=>calls.push('status'),pollDelay:()=>15000};
  vm.runInNewContext(source,context);await context.poll();assert.deepEqual(calls,['status']);
  context.active=true;await context.poll();assert.deepEqual(calls,['status','list','messages','drafts']);
  const caches=new Map(Array.from({length:8},(_,i)=>[String(i),[]])),tags=new Map([...caches.keys()].map(k=>[k,'old']));
  const reads={selected:'new',messageFailures:new Map(),messageTags:tags,messageCaches:caches,messages:[],conversations:[],console,
    cached:async()=>({tag:'new',data:{messages:[{id:'keep'}]}}),renderMessages(){}};
  vm.runInNewContext(js.slice(js.indexOf('async function refreshMessages('),js.indexOf('function updateComposer(){')),reads);
  await reads.refreshMessages();assert.equal(caches.size,8);assert.ok(caches.has('new'));assert.equal(tags.has('0'),false);assert.equal(caches.has('0'),false);
});
