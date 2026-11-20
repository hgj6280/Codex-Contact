import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openQqCompanion} from './qq-companion.mjs';
import {memoryAffect,rankMemories,decayedEmotion,memoryClarity} from './qq-affective-memory.mjs';

test('incidental experiences fade from active prompts while explicit recall and stable facts remain available',()=>{
  const fact={id:'event',kind:'event',terms:['剧场'],at:0,sourceId:'chat:1'};
  const affect={importance:0,reinforcements:1},at=70*86400000;
  assert.ok(memoryClarity(fact,affect,at)<.15);
  const old=new Map([['event',affect]]),query={terms:['剧场'],at,mood:null};
  assert.deepEqual(rankMemories([fact],old,query),[]);
  assert.deepEqual(rankMemories([fact],old,{...query,explicitRecall:true}),[fact]);
  for(const kind of ['profile','preference','promise'])assert.equal(memoryClarity({...fact,kind},affect,at),1);
  assert.equal(memoryClarity({...fact,sourceId:'manual:1'},affect,at),1);
  assert.ok(memoryClarity(fact,{importance:.9,reinforcements:5},at)>.5);
});
test('faded events stay in SQLite and can be recalled without crossing conversation scopes',async t=>{
  let time=10000;
  const {store}=await fixture(t,{now:()=>time,analyze:async prompt=>{
    const row=JSON.parse(prompt.split('\n').at(-1)).messages.at(-1);
    return JSON.stringify({facts:[{kind:'event',subject:'theatre',content:row.text,evidence:row.text,sourceId:row.sourceId,confidence:1,importance:0}]});
  }});
  store.observe({...person,text:'今天去剧场看了新演出'},'挺有意思');await store.flush({force:true});
  time+=70*86400000;
  assert.equal(store.recall({...person,text:'最近剧场有新演出'}).length,0);
  assert.equal(store.list(person).length,1);
  assert.equal(store.list(person)[0].retention.stage,'archived');
  assert.equal(store.list(person)[0].retention.active,false);
  assert.equal(store.recall({...person,text:'还记得之前的剧场演出吗'}).length>0,true);
  assert.match(store.context({...person,text:'还记得之前的剧场演出吗'}).memory,/按需查回的旧事/);
  assert.equal(store.recall({...person,groupId:'10018',text:'还记得之前的剧场演出吗'}).length,0);
  store.update({...store.snapshot(),forgetting:false});
  assert.equal(store.recall({...person,text:'最近剧场有新演出'}).length,1);
  assert.equal(store.list(person)[0].retention.active,true);
  store.command({...person,text:'/remember 剧场跑团安排需先确认时间'});
  const note=store.list(person).find(f=>f.kind==='note');assert.equal(note.retention.protected,true);
});

const person={type:'group_message',groupId:'20012',senderId:'10014'};
async function fixture(t,options={}){
  const dir=await mkdtemp(join(tmpdir(),'qq-affective-')),path=join(dir,'memory.sqlite');
  const store=await openQqCompanion(path,options);
  t.after(()=>{store.close();return rm(dir,{recursive:true,force:true});});
  return {store,path};
}
test('affect is confidence-bound, finite and bounded; emotions decay without a timer or permanent labels',()=>{
  assert.equal(memoryAffect({confidence:.7,importance:1}),null);
  assert.deepEqual(memoryAffect({confidence:1,importance:NaN,emotion:{valence:NaN}}),{importance:.5,emotion:null});
  assert.equal(memoryAffect({confidence:1,importance:9}).importance,1);
  assert.equal(decayedEmotion({at:1000,valence:1,arousal:-1,dominance:.5},1000).dominance,.5);
  assert.equal(decayedEmotion({at:1000,valence:1,arousal:-1,dominance:.5},86401000),null);
});
test('important rehearsed memories break relevant ties; emotion never outweighs stronger topic relevance',()=>{
  const facts=[{id:'ordinary',terms:['跑团'],at:100},{id:'important',terms:['跑团'],at:100},{id:'relevant',terms:['跑团','剧场'],at:100}];
  const affects=new Map([['ordinary',{importance:.1,reinforcements:1}],['important',{importance:1,reinforcements:12,emotion:{valence:.5,arousal:.5,dominance:.5}}]]);
  const ranked=rankMemories(facts,affects,{terms:['跑团','剧场'],mood:{valence:.5,arousal:.5,dominance:.5},at:1000});
  assert.deepEqual(ranked.map(x=>x.id),['relevant','important','ordinary']);
});
test('same background batch learns emotional significance and VAD, persists it, isolates scopes and clears all derived data',async t=>{
  let time=10000,calls=0;
  const {store,path}=await fixture(t,{now:()=>time,analyze:async prompt=>{
    calls++;const data=JSON.parse(prompt.split('\n').at(-1)),row=data.messages.at(-1);
    return JSON.stringify({facts:[{kind:'event',subject:'drawing-award',content:row.text,evidence:row.text,sourceId:row.sourceId,confidence:.95,importance:.95,emotion:{valence:.9,arousal:.8,dominance:.7}}],mood:{sourceId:row.sourceId,valence:.9,arousal:.8,dominance:.7,confidence:.95}});
  }});
  store.observe({...person,text:'我的画作第一次获奖了，真的好开心！'},'恭喜呀');
  assert.equal(calls,0);await store.flush({force:true});assert.equal(calls,1);
  assert.equal(store.snapshot().affectiveMemories,1);assert.equal(store.emotionState(person).dominance,.7);
  assert.match(store.context({...person,text:'画作获奖'}).social,/掌控感 0.7/);
  store.command({...person,text:'/remember 我喜欢喝草莓牛奶'});
  assert.doesNotMatch(store.context({...person,text:'还记得画作获奖吗'}).memory,/草莓牛奶/);
  assert.equal(store.emotionState({...person,senderId:'10017'}),null);
  assert.equal(store.emotionState({type:'private_message',senderId:person.senderId}),null);
  assert.match(store.command({...person,text:'/emotion'}).reply,/愉悦 0.9/);
  const probe=new DatabaseSync(path);t.after(()=>probe.close());
  let meta=probe.prepare('SELECT * FROM fact_affect').get();assert.equal(meta.reinforcements,1);
  // A distinct source confirming the same experience strengthens that memory.
  time++;store.observe({...person,text:'画作获奖这件事，到现在也很开心'},'真好呀');
  await store.flush({force:true});meta=probe.prepare('SELECT * FROM fact_affect').get();assert.equal(meta.reinforcements,2);
  time+=86400000;assert.equal(store.emotionState(person),null);
  assert.equal(store.recall({...person,text:'画作获奖'}).length>0,true);
  store.forget(person,'all');assert.equal(store.snapshot().affectiveMemories,0);
  assert.equal(store.emotionState(person),null);assert.equal(probe.prepare('SELECT count(*) AS n FROM moods').get().n,0);
});
test('manual corrections discard obsolete affect and cannot be overwritten by an older pending source',async t=>{
  let time=10000;
  const {store}=await fixture(t,{now:()=>time,analyze:async prompt=>{
    const row=JSON.parse(prompt.split('\n').at(-1)).messages.at(-1);
    return JSON.stringify({facts:[{kind:'preference',subject:'drink',content:'最喜欢草莓牛奶',evidence:row.text,sourceId:row.sourceId,confidence:1,importance:.9}],mood:null});
  }});
  store.observe({...person,text:'最喜欢草莓牛奶'},'嗯');await store.flush({force:true});
  store.observe({...person,text:'今天也买了草莓牛奶'},'好');time+=1000;
  store.revise(person,store.list(person)[0].id,'现在喜欢香蕉牛奶');assert.equal(store.snapshot().affectiveMemories,0);
  await store.flush({force:true});assert.equal(store.list(person)[0].content,'现在喜欢香蕉牛奶');
});
test('old SQLite mood schema upgrades in place without dropping facts, sources or current settings',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-affective-old-')),path=join(dir,'old.sqlite');t.after(()=>rm(dir,{recursive:true,force:true}));
  const old=new DatabaseSync(path);
  old.exec('CREATE TABLE moods(scope TEXT NOT NULL,user TEXT NOT NULL,valence REAL NOT NULL,arousal REAL NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(scope,user))');
  old.prepare('INSERT INTO moods VALUES(?,?,?,?,?)').run('group:'+person.groupId,person.senderId,.5,.5,Date.now());old.close();
  const store=await openQqCompanion(path);t.after(()=>store.close());
  assert.equal(store.emotionState(person).dominance,0);assert.ok(store.emotionState(person).valence>.4);
  assert.equal(store.snapshot().mechanismVersion,3);
  assert.equal(store.snapshot().diary,true);
});
