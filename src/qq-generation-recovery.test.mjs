import {promptPart} from './qq-observability.mjs';
import {protectQqModelIdentity} from './qq-model-identity.mjs';
import {finishQqVoiceReply} from './qq-voice-replies.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { mayRetryMissingImage,buildMissingImageRetryPrompt } from './qq-cli-diagnostics.mjs';
import { parseReferenceSpec,imageTaskArgs,buildReferenceSpecPrompt,selectQqImageModel } from './qq-image-quality.mjs';
import {useGeminiText, GEMINI_ROUTER_MODEL, isGeminiTextProvider} from './qq-text-context.mjs';
import { limitQqReplyText } from './qq-reply-length.mjs';
import {readImageReferenceWithRetry,formatImagePreflightFailure} from './qq-image-preflight.mjs';

test('production reply pipeline retries once for a missing tool, never sends old markers, and records tool failures',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('async function buildModelReply(event)');
  const end=source.indexOf('function limitQqStickerFrequency',start);
  async function run(mode){
    const saved=[],calls=[],files=new Map();let preparationCalls=0;const event={text:'画一张狐宫静哈气',type:'group_message'};
    const sandbox={
      promptPart,
      qqLife:null,protectQqModelIdentity,finishQqVoiceReply,readAloudText:()=>null,event,useGeminiText,GEMINI_ROUTER_MODEL,isGeminiTextProvider,limitQqReplyText,qqImageTasks:{run:task=>task()},stripMentionText:t=>t,isImageGenerationRequest:()=>true,
      localCodexPaths:{incomingImages:'/local/images'},prepareGenerationReferences:async()=>({inputs:[],imagePaths:[],mode:'default-character',character:{imagePaths:['/local/oc.png'],prompt:'OC'}}),
      dataDir:'/data',projectDir:'/project',qqCharacterDir:'/local/oc',codexTmpDir:'/local/out',codexWorkspaceDir:'/local/work',qqGeneratedArchiveDir:'/archive',
      join:(...p)=>p.join('/'),crypto:{randomUUID:()=>String(Math.random())},process:{env:{}},
      state:{ai:{model:'gpt-6-luna',reasoningEffort:'low'},qq:{enhancer:{enabled:false}}},selectQqImageModel,
      formatQuotedContext:()=>'',formatMemoryContext:()=>'',formatQqPersonaContext:()=>'',hasAnyQqImageReference:()=>false,
      formatQqStickerCatalog:()=>'',formatQqImageSummary:()=>'',buildAssistantInstructions:async()=>'',ensureCodexReplyWorkspace:async()=>{},
      writeValidationReport:async(_dir,r)=>{saved.push(structuredClone(r));return '/data/report.json';},
      buildReferenceSpecPrompt,parseReferenceSpec,imageTaskArgs,mayRetryMissingImage,buildMissingImageRetryPrompt,readImageReferenceWithRetry,formatImagePreflightFailure,
      ocrImage:async()=>({words:[],text:'',confidence:1}),readFile:async p=>files.get(p),cleanCodexReply:t=>t,
      shouldRequestExpandedQqContext:()=>assert.fail('image retries cannot expand unrelated chat history'),
      runCodexCli:async(args,prompt,options)=>{
        assert.equal(args[args.indexOf('-m')+1],'gpt-6-luna');
        const output=args[args.indexOf('-o')+1];
        if(!options.captureImages){
          preparationCalls++;
          if(mode==='preflight-transient' && preparationCalls===1)throw new Error('workspace routing discovery failed');
          if(mode==='preflight-denied')throw new Error('HTTP 403 authentication failed');
          files.set(output,JSON.stringify({expectedText:[],textConfidence:'high',pose:'按要求自由设计',identity:'狐宫静OC',props:'无',composition:'自由设计',constraints:[]}));return {};
        }
        calls.push(prompt);
        if(mode==='failed') {const error=new Error('image tool failed');error.cliDiagnostics={status:'failed',imageToolAttempted:true,events:[{error:'quota'}]};throw error;}
        files.set(output,'[[qq_image:/old/should-not-send.png]]');
        return {generatedImages:[],cliDiagnostics:{status:'completed',imageToolAttempted:mode==='attempted',events:[],stderr:''}};
      }
    };
    let reply,error;try{reply=await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',sandbox);}catch(e){error=e;}
    return {reply,error,saved,calls,preparationCalls};
  }
  const missing=await run('missing');assert.equal(missing.calls.length,2);
  assert.ok(missing.saved.some(r=>r.generationRetry?.attempted));assert.match(missing.reply,/没拿到新生成/);assert.doesNotMatch(missing.reply,/old/);
  const attempted=await run('attempted');assert.equal(attempted.calls.length,1);
  const failed=await run('failed');assert.equal(failed.calls.length,1);assert.match(failed.error.message,/failed/);
  assert.ok(failed.saved.some(r=>r.status==='generation-error'&&r.cliRuns[1].events[0].error==='quota'));
  const transient=await run('preflight-transient');assert.equal(transient.preparationCalls,2);
  assert.equal(transient.calls.length,2);assert.ok(transient.saved.some(r=>r.preflightAttempts?.length===2&&r.preflightAttempts[1].status==='completed'));
  const denied=await run('preflight-denied');assert.equal(denied.preparationCalls,1);assert.equal(denied.calls.length,0);
  assert.match(denied.reply,/登录授权/);assert.equal(denied.saved.at(-1).preflightFailureType,'authentication');
});
