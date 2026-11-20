import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {generateNanoBanana,buildNanoBananaPrompt,selectNanoBananaSize} from './qq-nanobanana.mjs';
import {patchNanoBananaRouterExecutor,assertNanoBananaRouterReferenceSupport,routerTextOnlyParts,routerImageParts} from './qq-nanobanana-router-patch.mjs';
const config=async()=>({models:{providers:{antigravity9router:{baseUrl:'http://127.0.0.1:20128/v1',apiKey:'test'}}}});
const png=Buffer.from([137,80,78,71,13,10,26,10]);
test('all reference images are sent in order and only returned image bytes become artifacts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nano2-'));try{const a=join(dir,'a.png'),b=join(dir,'b.png');await writeFile(a,png);await writeFile(b,png);
 let calls=0,record;const paths=await generateNanoBanana({prompt:'test',references:[a,b],size:'1024x1536',outputDir:join(dir,'out'),checkReferenceSupport:async()=>{},onRequest:r=>{record=r;},readConfig:config,fetchImpl:async(url,opts)=>{calls++;assert.equal(url,'http://127.0.0.1:20128/v1/images/generations');const body=JSON.parse(opts.body);assert.deepEqual(body.images,[a,b].map(()=>`data:image/png;base64,${png.toString('base64')}`));assert.equal(body.size,'1024x1536');assert.equal(opts.redirect,'error');return Response.json({data:[{b64_json:png.toString('base64')}]});}});
 assert.equal(calls,1);assert.deepEqual(await readFile(paths[0]),png);
 assert.equal(record.referenceCount,2);assert.deepEqual(record.references.map(r=>r.path),[a,b]);assert.equal(record.references[0].sha256.length,64);assert.doesNotMatch(JSON.stringify(record),/base64|Bearer/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('image-only prompt labels template and identity in attachment order without tool/chat contamination',()=>{
 const prompt=buildNanoBananaPrompt({request:'给狐宫静生成这个表情包',referenceCount:1,identityCount:1});
 assert.match(prompt,/本次用户要求：给狐宫静生成这个表情包/);
 assert.match(prompt,/图 1～图 1 是用户原图/);assert.match(prompt,/图 2 是狐宫静的 OC 身份参考/);
 assert.match(prompt,/动作、表情、镜头、构图、画风和文字全部以用户原图为准/);
 assert.match(prompt,/其他指定人物保持各自身份/);
 assert.doesNotMatch(prompt,/image_gen|referenced_image_paths|\/Users\/|qq_image|别惹我|网警|表情包库|最近消息|验收|修正/);
 assert.ok(prompt.length<1000);
 const other=buildNanoBananaPrompt({request:'画一张初音未来的图',referenceCount:1});
 assert.doesNotMatch(other,/红眼|金铃铛|长发|狐宫静/);
 const identityOnly=buildNanoBananaPrompt({request:'画一张狐宫静挥手',identityCount:1});
 assert.match(identityOnly,/图 1 是狐宫静的 OC 身份参考/);assert.doesNotMatch(identityOnly,/编辑底图/);
});
test('aspect ratio follows the user template or explicit request, not a portrait OC sheet',()=>{
 assert.equal(selectNanoBananaSize({width:600,height:900}),'1024x1536');
 assert.equal(selectNanoBananaSize({width:1920,height:1080}),'1792x1024');
 assert.equal(selectNanoBananaSize({request:'画成 9:16',width:1000,height:1000}),'1024x1792');
 assert.equal(selectNanoBananaSize({request:'画一只小猫'}),undefined);
});
test('router patch only touches image adapter and is idempotent and fail-closed on unknown versions',()=>{
 const fixture=`text-adapter:${routerTextOnlyParts};transformRequest(a,b,c,d){let e=d?.projectId;${routerTextOnlyParts};requestType:"image_gen";other:unchanged`;
 const fixed=patchNanoBananaRouterExecutor(fixture);
 assert.ok(fixed.startsWith(`text-adapter:${routerTextOnlyParts}`));assert.ok(fixed.includes(routerImageParts));
 assert.equal(patchNanoBananaRouterExecutor(fixed),fixed);
 assert.throws(()=>patchNanoBananaRouterExecutor('unknown'),/版本变化/);
 assert.throws(()=>assertNanoBananaRouterReferenceSupport('Reference images must be inline data URLs',fixture),/透传未修复/);
 assert.doesNotThrow(()=>assertNanoBananaRouterReferenceSupport('Reference images must be inline data URLs',fixed));
 // The previous filter drops both images; the fixed expression preserves their bytes and order.
 const parts=[{text:'request'},{inlineData:{mimeType:'image/jpeg',data:'template'}},{inlineData:{mimeType:'image/png',data:'oc'}}];
 assert.equal(Function('a',`return ${routerTextOnlyParts}`)({parts}).length,1);
 assert.deepEqual(Function('a',`return ${routerImageParts}`)({parts}),parts);
});
test('broken router reference support blocks before a generation request instead of drawing blindly',async()=>{
 let calls=0;
 await assert.rejects(generateNanoBanana({prompt:'edit',references:['not-read.png'],readConfig:config,checkReferenceSupport:async()=>{throw Error('reference support missing');},fetchImpl:async()=>{calls++;}}),/reference support missing/);
 assert.equal(calls,0);
});
test('upstream quota hidden inside HTTP 502 is reported without retries or leaking raw provider details',async()=>{
 let calls=0;
 await assert.rejects(generateNanoBanana({prompt:'test',readConfig:config,fetchImpl:async()=>{calls++;return Response.json({error:{message:'[502]: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"You have exhausted your capacity on this model. Your quota will reset after 38m50s.","account":"private@example.com"}}'}},{status:502});}}),error=>{
   assert.match(error.message,/额度暂时耗尽/);assert.match(error.message,/38m50s/);assert.doesNotMatch(error.message,/private@example|RESOURCE_EXHAUSTED/);return true;
 });
 assert.equal(calls,1);
});
test('server uses clean image-only prompt, records actual payload and keeps direct-send mode',async()=>{
 const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
 assert.match(source,/\? buildNanoBananaPrompt\(\{request:text,referenceCount:imagePaths.length,identityCount:character.imagePaths.length,identityDescription:character.appearance,identityName:character.name\|\|'狐宫静'\}\)/);
 assert.match(source,/const dimensions=imagePaths.length\?await readNanoBananaDimensions\(imagePaths\[0\]\)/);
 assert.match(source,/referenceRoles:modelImagePaths.map/);
 assert.match(source,/validationReport.status='ready-unvalidated'/);
 assert.match(source,/qqImageValidation: false/);
});
test('text-only and remote-URL responses are rejected without publishing or retrying',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nano2-'));try{let calls=0;await assert.rejects(generateNanoBanana({prompt:'test',outputDir:join(dir,'out'),readConfig:config,fetchImpl:async()=>{calls++;return Response.json({data:[{url:'https://invalid.example/image.png'}]});}}),/有效图片/);assert.equal(calls,1);assert.deepEqual(await readdir(dir),[]);}finally{await rm(dir,{recursive:true,force:true});}
});
