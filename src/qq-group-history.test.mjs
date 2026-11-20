import test from 'node:test';import assert from 'node:assert/strict';
import {backfillGroupHistory,createGroupHistoryReader} from './qq-group-history.mjs';
const g='20011';const row=(id,time,u='10012')=>({group_id:g,message_id:id,message_seq:id,time,user_id:u,sender:{nickname:u},message:[{type:'text',data:{text:'喜欢草莓'+id}}]});
test('SnowLuma pages by real message_id (not message_seq), dedupes overlap, and stops at requested date',async()=>{
 const calls=[],saved=[];const result=await backfillGroupHistory({groupId:g,start:150000,selfId:'10011',read:async(_g,p)=>{calls.push(p);return p.before==null?[row(4,400),row(3,300)]:[row(3,300),row(2,200),row(1,100)];},observe:r=>saved.push(r)});
 assert.equal(calls[1].before,3);assert.equal(result.complete,true);assert.deepEqual(saved.map(r=>r.messageId),['3','4','2']);assert.equal(result.imported,3);
});
test('no-progress, page cap and cross-group results never pretend complete coverage',async()=>{
 let result=await backfillGroupHistory({groupId:g,start:1,read:async()=>[row(2,200)],observe:()=>{},maxPages:3});assert.equal(result.complete,false);assert.equal(result.pages,2);
 result=await backfillGroupHistory({groupId:g,start:1,read:async()=>[row(2,200)],observe:()=>{},maxPages:1});assert.equal(result.complete,false);
 await assert.rejects(backfillGroupHistory({groupId:g,start:1,read:async()=>[{...row(2,200),group_id:'20010'}],observe:()=>assert.fail('wrong scope')}),/来源/);
});
test('network reader admits only fixed action and loopback endpoint, correlates echo, and closes socket',async()=>{
 let socket,sent;class FakeSocket{constructor(url){assert.ok(url.startsWith('ws://127.0.0.1:3001?'));socket=this;queueMicrotask(()=>this.onopen());}send(raw){sent=JSON.parse(raw);queueMicrotask(()=>this.onmessage({data:JSON.stringify({echo:sent.echo,status:'ok',retcode:0,data:{messages:[row(1,100)]}})}));}close(){this.closed=true;}}
 const read=createGroupHistoryReader({getToken:async()=> 'test',WebSocketImpl:FakeSocket});await read(g,{before:-123,count:100});assert.equal(sent.action,'get_group_msg_history');assert.equal(sent.params.message_id,-123);assert.equal(socket.closed,true);await assert.rejects(read('http://localhost',{}),/参数/);
});
