import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callMetadata,createReplyTimings,markContextStart,modelObservation,observeSends,promptPart,splitInput,withReplyTrace} from './qq-observability.mjs';
import {openUsageLedger,withUsageLedger} from './qq-usage.mjs';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'qq-metrics-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return dir;
}

test('parallel replies retain independent clocks, all bubble receipts and the original response',async t=>{
  const db=createReplyTimings(join(await fixture(t),'timing.sqlite'));
  const seen=[];
  const send=observeSends(async(_url,{ok})=>Response.json({status:'ok',retcode:0,data:{message_id:ok?1:null}}),row=>{db.save(row);seen.push(row);});
  const base=Date.now()-20;
  await Promise.all([0,1].map(i=>withReplyTrace({'x-qq-received-ms':base+i,'x-qq-enqueued-ms':base+5},async()=>{
    markContextStart();
    const meta=callMetadata({role:'reply'});
    modelObservation(meta,{first:Date.now(),last:Date.now()});
    for(const ok of [true,false]){
      const res=await send('/send_group_msg',{ok});
      assert.equal((await res.json()).data.message_id,ok?1:null);
    }
  })));
  for(let i=0;i<100&&seen.length<4;i++)await new Promise(r=>setTimeout(r,5));
  const rows=db.recent();
  assert.equal(rows.length,4);
  for(const n of [0,1]){
    const [a,b]=rows.filter(row=>row.receivedAt===base+n).sort((x,y)=>x.sendIndex-y.sendIndex);
    assert.equal(a.id,b.id);
    assert.equal(a.status,'sent');
    assert.equal(a.totalMs,a.receiptAt-a.receivedAt);
    assert.ok(a.stageMs.every(n=>Number.isInteger(n)&&n>=0));
    assert.equal(b.status,'unconfirmed');
    assert.equal(b.receiptAt,null);
  }
  assert.equal(new Set(rows.map(r=>r.id)).size,2);
});

test('provider totals reconcile with measured roles, shared work, image uncertainty and retries',async t=>{
  const dir=await fixture(t),ledger=await openUsageLedger(dir);
  await withReplyTrace({},async()=>{
    const prompt=[promptPart('rules','rules'),promptPart('history','prior'),'question'].join(' ');
    assert.equal(callMetadata({prompt,role:'memory'}).replyId,null);
    const call=ledger.start('test',{role:'memory',sharedRoles:['emotion'],prompt,retry:true,historySuffixBytes:5});
    call.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:90,output_tokens:7,cached_input_tokens:2}}));
    await call.finish('completed');
    let n=0;
    const provider=async()=>{n++;return {text:'[[qq_context_more]]',usage:{prompt_tokens:12,completion_tokens:2}};};
    await withUsageLedger(provider,{ledger,model:'test'})(prompt);
    assert.equal(n,1);
    const m=callMetadata({prompt,imageCount:1});
    assert.equal(splitInput(90,m).unattributed,90);
    assert.equal(splitInput(90,m).images,null);
    assert.equal(splitInput(90,m,31).images,31);
  });
  const totals=ledger.snapshot({breakdown:true}).byRole.total;
  assert.equal(totals.context.inputTokens,12);
  assert.equal(totals.emotion.sharedCalls,1);
  assert.equal(totals.emotion.inputTokens,0);
  assert.equal(totals.memory.retryInputTokens,90);
  assert.ok(totals.memory.inputParts.rules>0&&totals.memory.inputParts.history>0);
  assert.equal(Object.values(totals.memory.inputParts).reduce((a,b)=>a+b,0),90);
  for(const name of await readdir(join(dir,'calls'))){
    const raw=await readFile(join(dir,'calls',name),'utf8');
    assert.ok(!raw.includes('prior')&&!raw.includes('question'));
  }
});

test('queued image work inherits its submitter, and a persisted task has its own reply id',async()=>{
  const {createImageScheduler}=await import('./qq-image-scheduler.mjs');
  const {taskOrigin,withTaskTrace}=await import('./qq-observability.mjs');
  const scheduler=createImageScheduler({concurrency:1});
  let resume;
  const held=new Promise(resolve=>{resume=resolve;});
  const base=Date.now()-50;
  let firstId,secondId;
  const first=withReplyTrace({'x-qq-received-ms':base},()=>scheduler.run(async()=>{
    firstId=taskOrigin().replyId;await held;
  }));
  const second=withReplyTrace({'x-qq-received-ms':base+1},()=>{
    const submitted=taskOrigin();secondId=submitted.replyId;
    return scheduler.run(async()=>{
      assert.deepEqual(taskOrigin(),submitted);
      await withTaskTrace(JSON.parse(JSON.stringify(submitted)),()=>{
        assert.notEqual(taskOrigin().replyId,secondId);
        assert.equal(taskOrigin().received,base+1);
      });
    });
  });
  resume();await Promise.all([first,second]);assert.notEqual(firstId,secondId);
});
