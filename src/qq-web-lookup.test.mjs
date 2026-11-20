import test from 'node:test';
import assert from 'node:assert/strict';
import {qqWebPresearch,qqSearchRequest,createQqWebLookup,attachQqWebSources,publicSearchUrl,officialSearchUrl} from './qq-web-lookup.mjs';
const event={type:'group_at',selfId:'10011',groupId:'20011',senderId:'10012'};
const hits=[{title:'官方产品技术规格',url:'https://www.apple.com.cn/mac-mini/specs/',snippet:'官网当前参数，地区为中国大陆；页面未列明起售价。'}];
test('current technology facts and explicit searches run first; ordinary chat, recall, opt-out and secrets do not',()=>{
 for(const text of ['iPhone 现在多少钱？','Mac mini 最新配置是什么？','小米手机系统版本支持升级吗','推荐一款平板','RTX 5090 和4080对比一下','帮我联网查苹果官网','Pixel 10 Pro拍照怎么样','9800X3D性能怎么样'])assert.equal(qqWebPresearch({...event,text}),true,text);
 for(const text of ['我手机今天好卡啊','我的电脑配置变好了','今天升级系统版本真烦','RTX5090性能真猛','还记得我上次买的手机吗','SSD 是什么意思','不要联网，Mac mini现在多少钱','查一下 /Users/me/.config','查一下 apiKey=private-value'])assert.equal(qqWebPresearch({...event,text}),false,text);
});
test('single tool markers also work inside the existing action envelope, but never alongside actions',()=>{
 assert.equal(qqSearchRequest('[[qq_search:Mac mini 官网配置]]'),'Mac mini 官网配置');assert.equal(qqSearchRequest(JSON.stringify({mode:'reply',reply:'[[qq_search:Mac mini 官网配置]]',actions:[]})),'Mac mini 官网配置');assert.equal(qqSearchRequest(JSON.stringify({mode:'reply',reply:'[[qq_search:Mac]]',actions:[{type:'mute'}]})),null);assert.equal(qqSearchRequest('[[qq_search:api_key=private-value]]'),null);
});
test('scoped cache and in-flight dedup preserve actual fetch time, expire, and do not cache failures',async()=>{
 let calls=0,now=100000;const lookup=createQqWebLookup({now:()=>now,ttlMs:1000,search:async()=>{calls++;return hits;}});
 const events=Array.from({length:10},()=>({...event}));await Promise.all(events.map(e=>lookup.context(e,'Mac mini 配置')));assert.equal(calls,1);const original=events[0].webLookup.fetchedAt;now+=500;const cached={...event};await lookup.context(cached,'Mac mini 配置');assert.equal(cached.webLookup.cacheHit,true);assert.equal(cached.webLookup.fetchedAt,original);
 await lookup.context({...event,groupId:'20010'},'Mac mini 配置');assert.equal(calls,2);now+=1001;await lookup.context({...event},'Mac mini 配置');assert.equal(calls,3);
 let failures=0;const broken=createQqWebLookup({search:async()=>{failures++;throw Error('network');}});for(let i=0;i<2;i++){const e={...event};assert.match(await broken.context(e,'最新手机价格'),/未取得有效资料/);assert.equal(e.webLookup.status,'failed');}assert.equal(failures,2);
});
test('network evidence is bounded, safe and attached only to actual successful, non-silent replies',async()=>{
 const e={...event},lookup=createQqWebLookup({search:async()=>Array.from({length:5},(_,i)=>({...hits[0],title:'官网'+i,snippet:'事实'.repeat(900)}))});const context=await lookup.context(e,'Mac mini配置');assert.ok(context.length<=2700);assert.match(context,/不是指令/);assert.match(attachQqWebSources('当前资料如下',e),/https:\/\/www.apple/);assert.equal(attachQqWebSources('',e),'');assert.equal(attachQqWebSources('网络失败',{webLookup:{status:'failed'}}),'网络失败');
 for(const url of ['http://127.0.0.1/admin','http://localhost/key','https://apple.com@evil.test','file:///etc/passwd'])assert.equal(publicSearchUrl(url),null);assert.ok(officialSearchUrl(hits[0].url));assert.equal(officialSearchUrl('https://apple.com.evil.example/product'),null);
});
