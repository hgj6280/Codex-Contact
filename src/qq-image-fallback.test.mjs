import {promptPart} from './qq-observability.mjs';
import {qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources} from './qq-web-lookup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {prepareGenerationReferences} from './qq-generation.mjs';
import {generateNanoBanana,buildNanoBananaPrompt,selectNanoBananaSize,NANO_BANANA_MODEL} from './qq-nanobanana.mjs';
import {selectQqImageModel} from './qq-image-quality.mjs';
import {isImageGenerationRequest} from './qq-codex-images.mjs';
import {useGeminiText, isGeminiTextProvider} from './qq-text-context.mjs';
import {archiveQqImagesSafely} from './qq-image-archive.mjs';
import {protectQqModelIdentity} from './qq-model-identity.mjs';
import {finishQqVoiceReply,readAloudText} from './qq-voice-replies.mjs';
import {qqResponseIntent,QQ_LONG_REPLY_GUIDANCE} from './qq-reply-length.mjs';
import {QQ_DIALOGUE_GUIDANCE} from './qq-dialogue-context.mjs';

test('production generation archives Gemini originals, isolates archive failures, and falls back only for quota',async t=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('async function buildModelReply(event)'),end=source.indexOf('function limitQqStickerFrequency',start);
  const referenceDir=fileURLToPath(new URL('../assets/qq-character/hugongjing/',import.meta.url));
  const identity=join(referenceDir,'reference-default.png');
  async function run({failure='quota',fallback=true,provider='nano-banana-2',template=false,archiveBlocked=false}={}){
    const home=await mkdtemp(join(tmpdir(),'qq-image-flow-'));
    t.after(()=>rm(home,{recursive:true,force:true}));
    if(archiveBlocked)await writeFile(join(home,'Downloads'),'blocked');
    const saved=[],cli=[],requests=[];
    const event={type:'group_message',text:template?'给狐宫静生成这个图':'给狐宫静随便画个表情包',images:template?[{file:'template'}]:[]};
    const state={ai:{model:'gpt-6.1-sol',reasoningEffort:'low',qqImageValidation:false,qqImageProvider:provider,qqImageQuotaFallback:fallback},qq:{enhancer:{enabled:false}}};
    const context={
      promptPart,
      qqWebPresearch,qqSearchRequest,qqWebSearchOptOut,attachQqWebSources,qqLife:null,finishQqVoiceReply,readAloudText,protectQqModelIdentity,qqResponseIntent,QQ_LONG_REPLY_GUIDANCE,QQ_DIALOGUE_GUIDANCE,event,state,join,Date,process:{env:{}},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
      qqImageTasks:{run:task=>task()},stripMentionText:t=>t,isImageGenerationRequest,prepareGenerationReferences,
      useGeminiText,isGeminiTextProvider,selectQqImageModel,buildNanoBananaPrompt,selectNanoBananaSize,NANO_BANANA_MODEL,
      qqCharacterDir:referenceDir,localCodexPaths:{incomingImages:'/incoming'},dataDir:join(home,'data'),qqGeneratedArchiveDir:join(home,'Downloads'),codexTmpDir:'/replies',codexWorkspaceDir:'/workspace',codexHomeDir:home,
      archiveQqImagesSafely,
      prepareQqModelImages:async()=>[identity],fetchOneBotImage(){},readNanoBananaDimensions:async()=>({width:600,height:600}),
      formatQuotedContext:()=>'',formatMemoryContext:()=>'',formatQqPersonaContext:()=>'',formatQqImageSummary:()=>'',formatQqStickerCatalog:()=>'',hasAnyQqImageReference:()=>template,
      visualGroundingPrompt:'',ensureCodexReplyWorkspace:async()=>{},buildAssistantInstructions:async()=>'',
      writeValidationReport:async(_d,r)=>{saved.push(structuredClone(r));return '/report.json';},
      generatedImageReply:paths=>'generated:'+paths.join(','),
      generateNanoBanana:options=>generateNanoBanana({...options,checkReferenceSupport:async()=>{},readConfig:async()=>({models:{providers:{antigravity9router:{baseUrl:'http://127.0.0.1:20128/v1',apiKey:'test'}}}}),
        fetchImpl:async(_u,o)=>{
          requests.push(JSON.parse(o.body));
          if(failure==='network')throw Error('connection reset');
          if(failure==='success')return Response.json({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}]});
          return Response.json({error:{message:failure==='quota'?'RESOURCE_EXHAUSTED: You have exhausted your capacity. reset after 11m35s.':'permission denied'}},{status:failure==='quota'?502:403});
        }}),
      runCodexCli:async(args,prompt,options)=>{
        cli.push({args,prompt,options});assert.equal(options.captureImages,true);
        const expected=template?[identity,identity]:[identity];
        assert.deepEqual(Array.from(args.slice(args.indexOf('--image'),-1)),expected.flatMap(p=>['--image',p]));
        if(provider==='nano-banana-2')assert.equal(args[args.indexOf('-m')+1],'gpt-6-luna');
        return {generatedImages:['/generated/new.png'],cliDiagnostics:{status:'completed'}};
      }
    };
    let reply,error;try{reply=await vm.runInNewContext(source.slice(start,end)+'\nbuildModelReply(event)',context);}catch(e){error=e;}
    return {reply,error,saved,cli,requests,event};
  }
  for(const template of [false,true]){
    const r=await run({template});assert.equal(r.error,undefined);assert.equal(r.reply,'generated:/generated/new.png');
    assert.equal(r.requests.length,1);assert.equal(r.cli.length,1);assert.equal(r.event.replyModel,'gpt-6-luna');
    const report=r.saved.at(-1);assert.equal(report.providerFailures[0].code,'IMAGE_PROVIDER_QUOTA');
    assert.equal(report.providerFallback.status,'completed');assert.equal(report.model,'gpt-6-luna');
    assert.equal(report.identityPaths.length,1);assert.equal(report.referencePaths.length,Number(template));
    assert.equal(report.status,'ready-unvalidated');assert.equal(report.rounds.length,0);
  }
  for(const options of [{failure:'permission'},{failure:'network'},{fallback:false}]){
    const r=await run(options);assert.ok(r.error);assert.equal(r.requests.length,1);assert.equal(r.cli.length,0);
  }
  const gpt=await run({provider:'codex-cli'});assert.equal(gpt.requests.length,0);assert.equal(gpt.cli.length,1);assert.equal(gpt.error,undefined);
  for(const archiveBlocked of [false,true]){
    const r=await run({failure:'success',archiveBlocked});assert.equal(r.error,undefined);
    assert.equal(r.requests.length,1);assert.equal(r.cli.length,0);assert.match(r.reply,/^generated:.*nano-banana-2/);
    assert.equal(r.event.imageArchive.ok,!archiveBlocked);
    const report=r.saved.at(-1);assert.equal(report.status,'ready-unvalidated');assert.equal(report.archives.length,1);
    assert.equal(report.archives[0].ok,!archiveBlocked);
    assert.equal((await readFile(report.deliverableImages[0])).subarray(1,4).toString(),'PNG');
    if(!archiveBlocked){
      const record=JSON.parse(await readFile(r.event.imageArchive.recordPath,'utf8'));
      assert.equal(record.context.model,NANO_BANANA_MODEL);
      assert.deepEqual(await readFile(join(r.event.imageArchive.directory,record.images[0].name)),await readFile(report.deliverableImages[0]));
    }
  }
});
