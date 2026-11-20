// Explicit local-only live regression. Never sends anything to QQ and never
// enables preflight, quality review, repairs or automatic generation retries.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareGenerationReferences} from '../src/qq-generation.mjs';
import {generateNanoBanana,buildNanoBananaPrompt,readNanoBananaDimensions,selectNanoBananaSize} from '../src/qq-nanobanana.mjs';

const reportPath=process.argv[2];
if(!reportPath)throw new Error('Usage: node scripts/qq-nano-banana-regression.mjs <existing-validation-report.json>');
const previous=JSON.parse(await readFile(reportPath,'utf8'));
if(!previous.referencePaths?.length||!previous.identityPaths?.length)throw new Error('选择一条同时带用户原图和 OC 身份图的历史生图记录');
const root=resolve('tmp','nano-banana-regression-'+randomUUID());
await mkdir(root,{recursive:true,mode:0o700});
const cases=[{name:'oc-reference',request:previous.originalRequest,useOc:true},
  {name:'reference-only-control',request:'把这张图的灰色身体区域改为淡蓝色，其余内容保持不变，不添加文字，不换角色。生成图片。',useOc:false}];
const results=[];
for(const c of cases){
  const started=Date.now();
  const generation=await prepareGenerationReferences({event:{replyContext:{images:previous.referencePaths.map(file=>({file}))}},
    text:c.request,referenceDir:resolve(previous.identityPaths[0],'..'),prepareImages:async()=>previous.referencePaths});
  if(generation.error)throw new Error(generation.error);
  const references=[...generation.imagePaths,...generation.character.imagePaths];
  const prompt=buildNanoBananaPrompt({request:c.request,referenceCount:generation.imagePaths.length,identityCount:generation.character.imagePaths.length});
  const size=selectNanoBananaSize({request:c.request,...await readNanoBananaDimensions(generation.imagePaths[0])});
  const record={name:c.name,request:c.request,mode:generation.mode,sourceReport:reportPath,
    originalImages:previous.deliverableImages,qualityValidation:'disabled-by-user',sentToQq:false};
  try{
    record.images=await generateNanoBanana({prompt,references,size,outputDir:join(root,c.name),onRequest:async payload=>{
      record.generationRequest=payload;
      await writeFile(join(root,c.name+'-request.json'),JSON.stringify(record,null,2),{mode:0o600});
    }});
    record.status='generated';
  }catch(error){record.status='failed';record.error=error.message;}
  record.durationMs=Date.now()-started;results.push(record);
  await writeFile(join(root,'results.json'),JSON.stringify(results,null,2),{mode:0o600});
  console.log(JSON.stringify({name:c.name,status:record.status,error:record.error,durationMs:record.durationMs,images:record.images,referenceCount:references.length,root}));
}
if(results.some(r=>r.status!=='generated'))process.exitCode=1;
