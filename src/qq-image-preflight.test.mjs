import test from 'node:test';
import assert from 'node:assert/strict';
import {readImageReferenceWithRetry,classifyImagePreflightFailure,formatImagePreflightFailure} from './qq-image-preflight.mjs';

test('read-only routing failure retries once, records the failed attempt and preserves a successful result',async()=>{
  let calls=0;const saved=[],delays=[];
  const result=await readImageReferenceWithRetry({read:async()=>{if(++calls===1)throw new Error('workspace routing discovery failed');return '{"pose":"wave"}';},parse:JSON.parse,onAttempt:async row=>saved.push(row),wait:async ms=>delays.push(ms)});
  assert.equal(calls,2);assert.deepEqual(result.spec,{pose:'wave'});assert.equal(result.error,null);
  assert.deepEqual(saved.map(r=>r.status),['failed','completed']);assert.equal(saved[0].category,'connection');assert.deepEqual(delays,[750]);
});

test('permanent connection failure is bounded and does not blame reference images',async()=>{
  let calls=0;const result=await readImageReferenceWithRetry({read:async()=>{calls++;throw new Error('Connection failed: error sending request Bearer private-token');},parse:JSON.parse,wait:async()=>{}});
  assert.equal(calls,3);assert.equal(result.category,'connection');assert.equal(result.spec,null);
  assert.doesNotMatch(JSON.stringify(result),/private-token/);assert.match(formatImagePreflightFailure(result),/自动重试 2 次/);assert.match(formatImagePreflightFailure(result),/不需要重发参考图/);
});

test('access, authentication, quota, safety and unknown failures never retry',async()=>{
  for(const [message,category] of [['HTTP 451 no_biscuit_no_service workspace routing discovery failed','access'],['401 authentication Connection failed','authentication'],['429 quota exceeded connection failed','quota'],['content policy refusal','safety'],['local file disappeared','unknown']]){
    let calls=0;const result=await readImageReferenceWithRetry({read:async()=>{calls++;throw new Error(message);},parse:JSON.parse,wait:()=>assert.fail()});assert.equal(calls,1);assert.equal(result.category,category);
  }
  const invalid=await readImageReferenceWithRetry({read:async()=>'',parse:()=>null,wait:async()=>{}});assert.equal(invalid.category,'invalid-output');assert.equal(invalid.attempts.length,2);
  assert.equal(classifyImagePreflightFailure(Object.assign(new Error('Codex CLI timed out'),{code:'MODEL_TIMEOUT'})),'timeout');
  assert.equal(classifyImagePreflightFailure(Object.assign(new Error('workspace routing discovery failed'),{cliDiagnostics:{events:[{error:'429 usage limit'}]}})),'quota');
});

test('timeouts, malformed output and TLS disconnects recover only in bounded read-only attempts',async()=>{
  for(const error of [Object.assign(new Error('timed out'),{code:'MODEL_TIMEOUT'}),new Error('tls handshake eof')]){
    let calls=0;const result=await readImageReferenceWithRetry({read:async()=>{if(++calls===1)throw error;return '{}';},parse:JSON.parse,wait:async()=>{}});
    assert.equal(calls,2);assert.deepEqual(result.spec,{});
  }
  const contexts=[];
  const result=await readImageReferenceWithRetry({read:async(attempt,context)=>{contexts.push(context);return attempt===1?'not-json':'{}';},parse:raw=>{try{return JSON.parse(raw)}catch{return null}},wait:async()=>{}});
  assert.deepEqual(result.spec,{});assert.equal(contexts[1].retryReason,'invalid-output');
  let clock=0;
  const bounded=await readImageReferenceWithRetry({read:async()=>{clock=200000;throw new Error('Connection failed');},parse:JSON.parse,now:()=>clock,wait:()=>assert.fail('budget exhausted')});
  assert.equal(bounded.attempts.length,1);
});

test('a persistence failure does not retry a completed reference read',async()=>{
  let calls=0;await assert.rejects(readImageReferenceWithRetry({read:async()=>{calls++;return '{}';},parse:JSON.parse,onAttempt:async()=>{throw new Error('disk failure');},wait:()=>assert.fail()}),/disk failure/);assert.equal(calls,1);
});
