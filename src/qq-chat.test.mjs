import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openQqChat, isLocalChatRequest } from './qq-chat.mjs';

test('all contacts manual access remains separate from AI scope and @ emits actual OneBot segments',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'qq-chat-all-'));t.after(()=>rm(directory,{recursive:true,force:true}));let writes=0,payload;
  const options={directory,allowedGroups:()=>['20010'],allowedUsers:()=>[],chatGroups:()=>['20010','20015'],chatUsers:()=>['10012'],
    manualCall:async(a,p)=>{writes++;payload=p;return {message_id:321};},resolveMentions:async(group,ids)=>ids.map(id=>{if(id!=='10010')throw new Error('已不在此群');return {id,name:'群友'};})};
  const chat=await openQqChat(options);assert.throws(()=>chat.assertAllowed('20015'));await chat.record({groupId:'20015',messageId:320,message:'x'.repeat(13000)});assert.equal(chat.messages('20015')[0].text.length,13000);
  const input={groupId:'20015',text:'你好',mentions:['10010'],requestId:randomUUID()};const result=await chat.send(input);assert.equal(result.text,'@群友 你好');assert.deepEqual(payload.message[0],{type:'at',data:{qq:'10010'}});
  await chat.send(input);await (await openQqChat(options)).send(input);assert.equal(writes,1);
  await assert.rejects(chat.send({...input,requestId:randomUUID(),mentions:['all']}));await assert.rejects(chat.send({...input,requestId:randomUUID(),mentions:['10031']}),/不在此群/);
  await assert.rejects(chat.send({...input,requestId:randomUUID(),userId:'10012'}),/只有群聊/);
});
test('remote image descriptors preserve file IDs and more than eight pictures without truncation',async t=>{
  const {options}=await fixture(t,async()=>{throw new Error('offline')});const chat=await openQqChat({...options,remoteImages:true});
  const entry=await chat.record({groupId:'20010',messageId:777,message:Array.from({length:12},(_,i)=>({type:'image',data:{file:`file${i}`,url:`https://gchat.qpic.cn/${i}`}}))});assert.equal(entry.images.length,12);assert.ok(entry.images.every(url=>/^\/api\/qq\/chat\/image\/[a-f0-9]{64}$/.test(url)));
  const firstRevision=chat.revision();await chat.record({groupId:'20010',messageId:777,message:'duplicate'});assert.equal(chat.revision(),firstRevision);
});

async function fixture(t, transport) {
  const directory = await mkdtemp(join(tmpdir(), 'qq-chat-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, allowedGroups: () => ['20010','20015'], allowedUsers:()=>['10012'], oneBotApiBase:'http://bridge.test', fetchImpl:transport };
  return { chat:await openQqChat(options), options };
}
test('incoming messages are separated, deduplicated and persisted; unlisted groups stay inaccessible', async t => {
  const {chat,options} = await fixture(t, async () => { throw new Error('offline'); });
  const event = {post_type:'message',message_type:'group',group_id:20010,user_id:42,self_id:99,message_id:123,time:1790748000,
    message:[{type:'text',data:{text:'hello'}}],sender:{card:'玩家'}};
  await Promise.all([chat.ingest(event),chat.ingest(event)]);
  await chat.ingest({...event,group_id:20015,message_id:124});
  await chat.ingest({...event,group_id:10026,message_id:125});
  assert.equal(chat.messages('20010').length,1);
  assert.equal(chat.messages('20015').length,1);
  assert.throws(() => chat.messages('10026'));
  const reopened=await openQqChat(options);
  assert.equal(reopened.messages('20010')[0].text,'hello');
  assert.equal((await reopened.conversations()).length,2);
});
test('manual send is literal text to the selected allowed group and concurrent/restarted retries do not resend', async t => {
  let calls=0; let body;
  const {chat,options}=await fixture(t,async (url,init) => {
    calls++; body=JSON.parse(init.body);
    return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:456}})};
  });
  const input={groupId:'20015',text:'你好\n[CQ:at,qq=all]',requestId:randomUUID()};
  const results=await Promise.all([chat.send(input),chat.send(input)]);
  assert.equal(calls,1); assert.ok(results.every(r=>r.ok));
  assert.deepEqual(body,{group_id:20015,message:[{type:'text',data:{text:input.text}}]});
  await chat.ingest({post_type:'message',message_type:'group',group_id:20015,message_id:456,user_id:99,self_id:99,message:input.text});
  assert.equal(chat.messages('20015').length,1);
  const reopened=await openQqChat(options); assert.ok((await reopened.send(input)).ok); assert.equal(calls,1);
  await assert.rejects(chat.send({...input,groupId:'10026',requestId:randomUUID()}));
  await assert.rejects(chat.send({...input,text:'x'.repeat(2001),requestId:randomUUID()}));
});
test('failed and uncertain delivery never appear as sent or trigger automatic retries', async t => {
  let calls=0;
  const {chat}=await fixture(t,async()=>{calls++;throw new Error('timeout')});
  const input={groupId:'20010',text:'test',requestId:randomUUID()};
  assert.equal((await chat.send(input)).status,'unknown');
  assert.equal((await chat.send(input)).ok,false); assert.equal(calls,1);
  assert.equal(chat.messages('20010')[0].status,'unknown');
});
test('chat write endpoints accept the local panel and reject foreign origins/hosts', () => {
  assert.ok(isLocalChatRequest({headers:{host:'127.0.0.1:3789',origin:'http://127.0.0.1:3789'}}));
  assert.ok(isLocalChatRequest({headers:{host:'127.0.0.1:3789'}}));
  assert.ok(!isLocalChatRequest({headers:{host:'127.0.0.1:3789',origin:'https://other.test'}}));
  assert.ok(!isLocalChatRequest({headers:{host:'other.test:3789'}}));
});
test('image previews retain safe QQ URLs and cache outbound image bytes without accepting foreign URLs', async t => {
  const {chat}=await fixture(t,async()=>{throw new Error('offline')});
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==','base64');
  const entry=await chat.record({groupId:'20010',messageId:900,message:[
    {type:'image',data:{file:`base64://${bytes.toString('base64')}`}},
    {type:'image',data:{url:'https://gchat.qpic.cn/example.png'}},
    {type:'image',data:{url:'https://foreign.test/example.png'}}
  ]});
  assert.equal(entry.images.length,2);
  assert.equal(entry.images[1],'https://gchat.qpic.cn/example.png');
  assert.equal(entry.text,'[图片]');
  assert.deepEqual(await chat.media(entry.images[0].split('/').at(-1)),bytes);
  await assert.rejects(chat.media('../messages.json'));
});
test('private whitelist, incoming/self echo and verified send use the correct recipient',async t=>{
  let sent;
  const {chat}=await fixture(t,async(url,init)=>{
    if(!init)return {ok:true,json:async()=>({status:'ok',data:[]})};
    sent={url,body:JSON.parse(init.body)};return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:91}})};
  });
  await chat.ingest({post_type:'message',message_type:'private',user_id:10012,self_id:10011,message_id:90,message:'hello',sender:{nickname:'朋友'}});
  const before=chat.revision();
  const result=await chat.send({userId:'10012',text:'你好',requestId:randomUUID(),replyMessageId:'90'});
  assert.ok(result.ok);assert.ok(chat.revision()>before);
  assert.equal(sent.url,'http://bridge.test/send_private_msg');assert.equal(sent.body.user_id,10012);
  assert.deepEqual(sent.body.message[0],{type:'reply',data:{id:'90'}});
  await chat.ingest({post_type:'message_sent',message_type:'private',user_id:10011,self_id:10011,target_id:10012,message_id:91,message:'你好'});
  assert.equal(chat.messages('private:10012').length,2);
  assert.ok((await chat.allConversations()).some(c=>c.id==='private:10012'&&c.type==='private'&&c.name==='朋友'));
  await assert.rejects(chat.send({userId:'10019',text:'x',requestId:randomUUID()}));
  assert.throws(()=>chat.messages('private:10019'));
});
test('manual image and quote are validated, cached and delivered once',async t=>{
  let calls=0,payload;
  const {chat}=await fixture(t,async(url,init)=>{calls++;payload=JSON.parse(init.body);return {ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:700}})};});
  const imageBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==';
  await chat.record({groupId:'20010',messageId:699,message:'参考'});
  const input={groupId:'20010',text:'',imageBase64,imageType:'image/png',replyMessageId:'699',requestId:randomUUID()};
  assert.ok((await chat.send(input)).ok);assert.ok((await chat.send(input)).ok);assert.equal(calls,1);
  assert.equal(payload.message[1].data.file,`base64://${imageBase64}`);
  const image=chat.messages('20010').at(-1).images[0];assert.match(image,/chat-media/);
  assert.ok((await chat.media(image.split('/').at(-1))).length>0);
  await assert.rejects(chat.send({...input,text:'换内容'}));
  await assert.rejects(chat.send({...input,groupId:'20015',requestId:randomUUID()}),/引用/);
  await assert.rejects(chat.send({...input,imageBase64:Buffer.from('not an image').toString('base64'),requestId:randomUUID()}),/只支持/);
  await assert.rejects(chat.send({...input,imageBase64:Buffer.alloc(5*1024*1024+1).toString('base64'),requestId:randomUUID()}),/5 MB/);
});
test('concurrent id reuse cannot replace the message while delivery is pending',async t=>{
  let release;const {chat}=await fixture(t,()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({status:'ok',retcode:0,data:{message_id:9}})});}));
  const input={groupId:'20010',text:'one',requestId:randomUUID()};const sending=chat.send(input);
  await assert.rejects(chat.send({...input,text:'two'}),/另一条/);
  while(!release)await new Promise(resolve=>setImmediate(resolve));release();assert.ok((await sending).ok);
});
test('miniapp cards retain visible metadata but cannot expose unsafe links',async t=>{
  const {chat}=await fixture(t,async()=>{throw new Error('offline')});
  const before=chat.revision();const preview=await chat.preview([{type:'json',data:{data:JSON.stringify({meta:{detail_1:{title:'农场',desc:'邀请',qqdocurl:'javascript:alert(1)',appid:'123'}}})}}]);
  assert.equal(preview.cards[0].title,'农场');assert.equal(preview.cards[0].url,null);
  assert.equal(chat.revision(),before);assert.equal(chat.messages('20010').length,0);
});
