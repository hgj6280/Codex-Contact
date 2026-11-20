import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openUsageLedger,withUsageLedger,formatUsageReply} from './qq-usage.mjs';

test('new accounting period preserves old files; every local invocation counts once and all real models use reference rates',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'usage-policy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let clock=new Date('2026-11-07T00:00:00Z'),ledger=await openUsageLedger(dir,{now:()=>clock});
 const old=ledger.start('gpt-6.1-sol');old.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:999,output_tokens:1,cached_input_tokens:0}}));await old.finish('completed');
 clock=new Date('2026-11-08T00:00:00Z');
 await writeFile(join(dir,'billing-policy.json'),JSON.stringify({version:1,name:'DeepSeek V4.1 Flash',startedAt:clock.toISOString(),inputUsd:.15,cachedUsd:.003,outputUsd:.6}));
 ledger=await openUsageLedger(dir,{now:()=>clock});
 const reply=withUsageLedger(async()=>({text:'你好',usage:{available:true,prompt_tokens:1000000,completion_tokens:100000,prompt_tokens_details:{cached_tokens:800000}}}),{ledger,model:'local-qwen35-4b'});
 await reply('first');await reply('retry');
 const missing=withUsageLedger(async()=>({text:'no usage'}),{ledger,model:'other'});await missing();
 const fail=withUsageLedger(async()=>{throw Error('network')},{ledger,model:'gpt-6-luna'});await assert.rejects(fail(),/network/);
 const s=ledger.snapshot();assert.equal(s.total.totalTokens,2201000);assert.equal(s.total.calls,5);assert.equal(s.total.incompleteCalls,2);assert.ok(Math.abs(s.total.estimatedUsd-(.1848+.002008))<1e-12);assert.match(formatUsageReply(s),/DeepSeek V4.1 Flash 低峰价/);
 assert.equal((await openUsageLedger(dir,{now:()=>clock})).snapshot().total.totalTokens,2201000);
});

test('official peak boundaries, weekend and public holiday rates are deterministic',async()=>{
 const {referenceCost}=await import('./qq-reference-pricing.mjs');
 const u={inputTokens:1000000,cachedInputTokens:0,outputTokens:0},p={inputUsd:.15,cachedUsd:.003,outputUsd:.6,peakValley:true,holidays:['2026-10-01']};
 for(const [at,want] of [['2026-11-09T00:59:59Z',.15],['2026-11-09T01:00:00Z',.3],['2026-11-09T04:00:00Z',.15],['2026-11-09T06:00:00Z',.3],['2026-11-09T10:00:00Z',.15],['2026-11-08T02:00:00Z',.15],['2026-10-01T02:00:00Z',.15]])assert.equal(referenceCost(u,at,p),want,at);
});

 test('compact group quote omits billing boilerplate but preserves requested token details',()=>{
 const counts={totalTokens:100,inputTokens:80,outputTokens:20,cachedInputTokens:30,estimatedCny:.001,unpricedTokens:0};
 const snapshot={today:counts,total:counts,billingPolicy:{peakValley:true}};
 assert.equal(formatUsageReply(snapshot,'今日用量',{compact:true}),'今日 100 token，约 ¥0.0010。');
 assert.match(formatUsageReply(snapshot,'今日输入输出明细',{compact:true}),/输入 80／输出 20／缓存 30/);
 assert.doesNotMatch(formatUsageReply(snapshot,'',{compact:true}),/非实际扣款|附加费|等价估算/);
 assert.match(formatUsageReply(snapshot),/非实际扣款/);
 });

test('QQ cost-only query stays short while explicit usage still includes tokens',()=>{
 const counts={totalTokens:1000,inputTokens:900,outputTokens:100,cachedInputTokens:0,estimatedCny:1.2345,unpricedTokens:0};
 const snapshot={today:counts,total:counts};
 assert.equal(formatUsageReply(snapshot,'费用统计',{compact:true}),'今日约 ¥1.2345；累计约 ¥1.2345。');
 assert.match(formatUsageReply(snapshot,'token统计',{compact:true}),/1,000 token/);
});
