import test from 'node:test';
import assert from 'node:assert/strict';
import { createCliDiagnostics,mayRetryMissingImage,buildMissingImageRetryPrompt,missingImageFailureReply } from './qq-cli-diagnostics.mjs';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import vm from 'node:vm';
test('streamed tool errors and image tool attempts survive split JSON lines with secrets redacted',()=>{
  const tracker=createCliDiagnostics();
  const data=JSON.stringify({type:'thread.started',thread_id:'t'})+'\n'+JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',tool:'image_gen',status:'failed',error:{message:'quota exceeded Bearer abc-secret https://qq.test/x?rkey=secret'},result:{content:[{type:'text',text:'failed'}]}}})+'\n';
  tracker.write(data.slice(0,30));tracker.write(data.slice(30));
  const result=tracker.finish({status:'completed',code:0,stderr:'',durationMs:10});
  assert.equal(result.threadId,'t');assert.equal(result.imageToolAttempted,true);
  assert.match(result.events[0].error,/quota exceeded/);
  assert.doesNotMatch(JSON.stringify(result),/abc-secret|rkey=secret/);
  assert.equal(mayRetryMissingImage(result),false);
});
test('only clean completion without any image tool attempt may get one explicit generation retry',()=>{
  const d={status:'completed',imageToolAttempted:false,events:[],stderr:''};
  assert.equal(mayRetryMissingImage(d),true);
  for(const result of [undefined,{...d,status:'timeout'},{...d,imageToolAttempted:true},{...d,stderr:'warning'},{...d,events:[{error:'policy refusal'}]}]) assert.equal(mayRetryMissingImage(result),false);
  const prompt=buildMissingImageRetryPrompt({request:'画狐宫静',inputs:['/oc.png'],expected:{expectedText:[]}});
  assert.match(prompt,/referenced_image_paths 必须为 \["\/oc.png"\]/);
  assert.match(prompt,/不换词绕过限制/);
});
test('routine CLI notices do not suppress recovery; native artifacts prove an image call',()=>{
  const stderr='Reading prompt from stdin...\n2026-10-01T00:00:00Z WARN codex_rollout::list: state db discrepancy during find_thread_path_by_id: falling_back\n';
  const empty=createCliDiagnostics().finish({status:'completed',code:0,stderr,durationMs:1});
  assert.equal(mayRetryMissingImage(empty),true);
  const generated=createCliDiagnostics().finish({status:'completed',code:0,stderr,durationMs:1,generatedImageCount:1});
  assert.equal(generated.imageToolAttempted,true);assert.equal(mayRetryMissingImage(generated),false);
  const error=createCliDiagnostics().finish({status:'completed',code:0,stderr:stderr+'quota exceeded',durationMs:1});
  assert.equal(mayRetryMissingImage(error),false);
});
test('native image moderation errors remain visible even when CLI exits zero without a JSON image-tool event',()=>{
  const stderr='Reading prompt from stdin...\nERROR codex_core::tools::router: error=image generation failed: http 400 Bad Request: '+JSON.stringify(JSON.stringify({error:{code:'moderation_blocked',moderation_details:{categories:['public-figure']}}}));
  const d=createCliDiagnostics().finish({status:'completed',code:0,stderr,durationMs:12});
  assert.equal(d.imageToolAttempted,true);assert.equal(d.failureKind,'safety');assert.equal(d.safetyCategory,'public-figure');assert.equal(mayRetryMissingImage(d),false);
  assert.match(missingImageFailureReply(d),/服务将参考内容判为涉及公众人物/);
  assert.doesNotMatch(missingImageFailureReply(d),/额度|离线|网络|API|本机路径/);
  assert.doesNotMatch(missingImageFailureReply({}),/安全检查/);
});
test('pre-generation connection failures are classified without hiding refusals or executed image calls',()=>{
  const failed=createCliDiagnostics();failed.write(JSON.stringify({type:'turn.failed',error:{message:'workspace routing discovery failed'}})+'\n');
  assert.equal(failed.finish({status:'failed',code:1,stderr:'',durationMs:170000}).failureKind,'connection');
  assert.equal(createCliDiagnostics().finish({status:'failed',code:1,stderr:'HTTP 403 policy refusal',durationMs:1}).failureKind,null);
  const tool=createCliDiagnostics();tool.write(JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',tool:'image_gen',status:'failed',error:'error sending request for url'}})+'\n');
  assert.equal(tool.finish({status:'failed',code:1,stderr:'',durationMs:1}).failureKind,null);
});
test('production CLI runner returns diagnostics on success and attaches them on timeout and exit failure',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function runCodexCli(args, input, options)');
  const end=source.indexOf('async function ensureCodexReplyWorkspace',start);
  const run=async(mode,captureDiagnostics=true)=>{
    const spawn=(_path,_args,options)=>{
      assert.equal(options.env.HTTPS_PROXY,'http://system-proxy:7897');
      const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
      child.stdin=Object.assign(new EventEmitter(),{end(){if(mode==='timeout')return;setImmediate(()=>{
        child.stdout.write(JSON.stringify({type:'thread.started',thread_id:'diagnostic-thread'})+'\n');
        if(mode==='failed')child.stderr.write('upstream failure');child.emit('close',mode==='failed'?1:0);
      });}});return child;
    };
    return vm.runInNewContext(source.slice(start,end)+'\nrunCodexCli([],"hello",options)',{
      options:{cwd:'/local',env:{},timeout:mode==='timeout'?10:1000,captureDiagnostics},
      codexCliEnvironment:async env=>({...env,HTTPS_PROXY:'http://system-proxy:7897'}),
      spawn,codexCliPath:'/cli',Date,setTimeout,clearTimeout,
      state:{maintenance:{codex:{}}},createCliDiagnostics,refreshCodexQuotaSnapshotAfterRun:async()=>{}
    });
  };
  const result=await run('completed');assert.equal(result.cliDiagnostics.threadId,'diagnostic-thread');
  assert.equal(result.cliDiagnostics.status,'completed');
  assert.equal((await run('completed',false)).cliDiagnostics,undefined);
  await assert.rejects(run('failed'),error=>error.cliDiagnostics.status==='failed'&&error.cliDiagnostics.stderr==='upstream failure');
  await assert.rejects(run('timeout'),error=>error.cliDiagnostics.status==='timeout'&&error.code==='MODEL_TIMEOUT');
});

test('a hung owned CLI is terminated then killed; a normal close cancels escalation',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8'),start=source.indexOf('function runCodexCli(args, input, options)'),end=source.indexOf('async function ensureCodexReplyWorkspace',start);
  for(const exits of [false,true]){
    const signals=[];const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=Object.assign(new EventEmitter(),{end(){}});
    child.kill=signal=>{signals.push(signal);if(exits){child.signalCode=signal;child.emit('close',null);}};
    const state={maintenance:{codex:{}}};
    const promise=vm.runInNewContext(source.slice(start,end)+'\nrunCodexCli([],"test",options)',{codexCliEnvironment:async env=>env,spawn:()=>child,codexCliPath:'/owned-cli',options:{cwd:'/local',env:{},timeout:5,killGraceMs:5},Date,setTimeout,clearTimeout,state});
    await assert.rejects(promise,e=>e.code==='MODEL_TIMEOUT');await new Promise(r=>setTimeout(r,20));
    assert.deepEqual(signals,exits?['SIGTERM']:['SIGTERM','SIGKILL']);assert.equal(state.maintenance.codex.lastOk,false);
  }
  const formatStart=source.indexOf('function formatQqModelFailure(error)'),formatEnd=source.indexOf('\nasync function',formatStart);
  const format=vm.runInNewContext(source.slice(formatStart,formatEnd)+'\nformatQqModelFailure');
  assert.match(format({code:'MODEL_TIMEOUT'}),/回复超时/);assert.doesNotMatch(format(new Error('failed')),/我再试一次|本机路径/);
  assert.match(format({code:'MODEL_CONNECTION'}),/模型连接失败/);
  const quota=format({code:'IMAGE_PROVIDER_QUOTA',retryAt:'2026-10-23T15:29:00Z'});
  assert.match(quota,/Gemini 生图额度暂时不足/);assert.match(quota,/23:29/);assert.match(quota,/切换 GPT/);assert.doesNotMatch(quota,/后台已记录错误/);
});
