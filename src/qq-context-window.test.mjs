import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QQ_CONTEXT_POLICY,trimContextPool,selectQqContext,contextTerms} from './qq-context-window.mjs';
import {openQqChat} from './qq-chat.mjs';
import {openQqAutonomy} from './qq-autonomy.mjs';
const now=Date.now(),group='20012',user='10014';
const event={type:'group_message',groupId:group,senderId:user,selfId:'10015',text:'周六星河剧场跑团几点在哪集合？',raw:{message_id:'179'}};
const history=()=>Array.from({length:180},(_,i)=>({id:String(i),user,name:'群友',text:'今天随便聊聊别的事情',at:now-(180-i)*1000}));
test('searches 120 messages while including an old relevant exchange and keeping the prompt within 16 rows / 2800 characters',()=>{
  const rows=history();rows[75].text='周六星河剧场跑团晚八点在东门集合';rows[76].text='好的，我从南门绕到东门找你';rows[179].text=event.text;
  const r=selectQqContext(rows,event,{now});assert.equal(r.stats.available,120);assert.ok(r.rows.some(m=>m.id==='75'));assert.ok(r.rows.some(m=>m.id==='76'));assert.ok(r.rows.some(m=>m.id==='179'));
  assert.ok(r.stats.olderSelected>0);assert.ok(r.rows.length<=16);assert.ok(r.text.length<=2800);assert.equal(r.stats.chars,r.text.length);
});
test('older bot references do not displace the most recent human antecedent; quote chains and chronology survive selection',()=>{
  const rows=history();rows[90]={...rows[90],text:'狐宫静刚才还在群里',selfReference:true};rows[178].text='小林刚给小陈买奶茶去了，她才出门';rows[179].text='她怎么还没回来呀？';
  const r=selectQqContext(rows,{...event,text:rows[179].text,replyMessageId:'92'},{now,referenceIds:['90']});
  assert.ok(r.rows.some(m=>m.id==='90'));assert.ok(r.rows.some(m=>m.id==='178'));assert.ok(r.rows.some(m=>m.id==='92'));
  assert.deepEqual(r.rows.map(m=>Number(m.id)),r.rows.map(m=>Number(m.id)).sort((a,b)=>a-b));
});
test('large Unicode messages stay well formed and bounded; expired/future rows do not enter the window',()=>{
  const rows=history().map(m=>({...m,text:'🦊很长的聊天内容'.repeat(1000),name:'🦊'.repeat(200)}));
  rows.push({id:'expired',user,at:now-QQ_CONTEXT_POLICY.maxAgeMs-1,text:'不该出现的旧内容'},{id:'future',user,at:now+10000,text:'未来消息'});
  const r=selectQqContext(rows,event,{now});assert.ok(r.text.length<=2800);assert.ok(r.text.isWellFormed());assert.doesNotMatch(r.text,/不该出现|未来消息/);
  assert.equal(trimContextPool(rows,now).length,120);
});
test('cached lexical features update when a native preflight refreshes the same row',()=>{
  const row={text:'杭州的周末活动'};assert.ok(contextTerms(row).has('杭州'));row.text='上海的周末活动';assert.ok(contextTerms(row).has('上海'));assert.ok(!contextTerms(row).has('杭州'));
});
test('quoted discussion follows source chain without unrelated adjacent speakers or cross-group rows',()=>{
  const rows=history();
  rows[74]={...rows[74],user:'10017',text:'茅台股票今天涨了多少'};
  rows[75]={...rows[75],user:'10018',text:'周六星河剧场跑团八点集合',replyTo:'70'};
  rows[70]={...rows[70],user:'10016',text:'这是跑团原始约定',replyTo:'75'};
  rows[76]={...rows[76],user:'10027',text:'另一个人的网购订单'};
  rows[77]={...rows[77],groupId:'20017',text:'周六星河剧场跑团，外群秘密'};
  rows[179].text=event.text;
  const r=selectQqContext(rows,{...event,replyMessageId:'75'},{now});
  assert.ok(r.rows.some(m=>m.id==='75'));assert.ok(r.rows.some(m=>m.id==='70'));
  for(const id of ['74','76','77'])assert.ok(!r.rows.some(m=>m.id===id));
  assert.ok(r.text.length<=2800);assert.equal(new Set(r.rows.map(m=>m.id)).size,r.rows.length);
});
test('adjacent feedback preserves both halves, but cannot cross another speaker, target or stale boundary',()=>{
  const rows=[{id:'p',user,text:'前半句指出了一个问题',at:now-6000},{id:'b',user:event.selfId,text:'上一轮回复',at:now-5000},{id:'c',user,text:'后半句带一点客套肯定',at:now-1000}];const e={...event,text:rows[2].text,raw:{message_id:'c'}};
  const r=selectQqContext(rows,e,{now});assert.deepEqual(r.stats.speakerRun,['p','c']);assert.ok(r.text.includes(rows[0].text));
  rows[1].user='10017';assert.deepEqual(selectQqContext(rows,e,{now}).stats.speakerRun,['c']);rows[1].user=event.selfId;rows[0].at=now-91000;assert.deepEqual(selectQqContext(rows,e,{now}).stats.speakerRun,['c']);
  rows[0].at=now-6000;rows[0].addressedTo=['10017'];assert.deepEqual(selectQqContext(rows,e,{now}).stats.speakerRun,['c']);
});
test('local recent reads copy only the bounded tail, preserve full chat history and reject other conversations',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-recent-read-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'messages.json'),JSON.stringify({version:1,groups:{[group]:Array.from({length:300},(_,i)=>({messageId:String(i),text:'消息'+i,images:[]}))},requests:{},names:{},media:{},seeded:true}));
  const s=await openQqChat({directory:dir,allowedGroups:()=>[group]});const a=s.recentMessages(group);assert.equal(a.length,120);assert.equal(a[0].messageId,'180');a[0].text='改了副本';assert.equal(s.recentMessages(group)[0].text,'消息180');
  assert.equal(s.messages(group).length,300);assert.throws(()=>s.recentMessages('20016'));assert.throws(()=>s.recentMessages(group,121));assert.throws(()=>s.recentMessages(group,0));
});
test('passive observation remains bounded and can refer to a bot mention more than eight messages ago',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-long-attention-'));t.after(()=>rm(dir,{recursive:true,force:true}));let time=now;
  const s=await openQqAutonomy(join(dir,'state.json'),{now:()=>time,getRoutine:()=>({enabled:false}),getIdentity:()=>({names:['狐宫静']}),allowed:()=>true,management:{requests:()=>[]}});
  for(let i=0;i<150;i++){s.observe({...event,text:i===120?'狐宫静刚才还在群里':'闲聊'+i,raw:{message_id:i}});time+=1000;}
  const e={...event,text:'她呢？',raw:{message_id:151},senderId:'10017'};s.observe(e);e.proactiveDecision=s.candidate(e);assert.equal(e.proactiveDecision.contextual,true);assert.ok(e.proactiveDecision.attention.anchorIds.includes('120'));
  const p=s.prompt(e);assert.match(p,/狐宫静刚才还在群里/);assert.equal(e.autonomyContextStats.available,120);assert.ok(e.autonomyContextStats.selected<=16);
  await s.reset(e);const fresh={...e,raw:{message_id:152},proactiveDecision:undefined};s.observe(fresh);assert.equal(s.candidate(fresh),null);
});
