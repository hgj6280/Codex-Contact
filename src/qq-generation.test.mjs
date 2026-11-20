import {promptPart} from './qq-observability.mjs';
import {isLocalTextProvider,isQqHttpTextProvider} from './qq-local-model.mjs';
import {qqExplicitWebSearch,qqWebPresearch,attachQqWebSources,qqWebSearchOptOut} from './qq-web-lookup.mjs';
import {protectQqModelIdentity} from './qq-model-identity.mjs';
import {finishQqVoiceReply} from './qq-voice-replies.mjs';
import test from 'node:test';
import {useGeminiText, GEMINI_ROUTER_MODEL, isGeminiTextProvider} from './qq-text-context.mjs';
import { limitQqReplyText } from './qq-reply-length.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import {buildNanoBananaPrompt,selectNanoBananaSize,NANO_BANANA_MODEL} from './qq-nanobanana.mjs';
import vm from 'node:vm';
import { collectGenerationReferences, prepareGenerationReferences, requestsHugongjingOc,resolveGenerationIdentity } from './qq-generation.mjs';
import { isImageGenerationRequest } from './qq-codex-images.mjs';
import { mayRetryMissingImage, buildMissingImageRetryPrompt } from './qq-cli-diagnostics.mjs';
import {readImageReferenceWithRetry,formatImagePreflightFailure} from './qq-image-preflight.mjs';
import { buildReferenceSpecPrompt, parseReferenceSpec, buildDetailedReviewPrompt, buildTextConfirmationPrompt, validateGeneratedImages, imageTaskArgs, visualGroundingPrompt, selectQqImageModel, qualityCategories } from './qq-image-quality.mjs';
const referenceDir = fileURLToPath(new URL('../assets/qq-character/hugongjing/', import.meta.url));

test('explicit OC intent is distinct from addressing the bot or preserving another character', () => {
  for (const text of ['给狐宫静生成这个图', '給狐宫静生成这个图', '给 狐宫静 的 OC 生成这个图', '用狐宫静模仿原图', '把角色换成狐宫静', '画一张狐宫静的图', '给我画一张黑丝狐宫静', '重新画一个白丝狐宫静']) {
    assert.equal(requestsHugongjingOc(text), true, text);
  }
  for (const text of ['给狐宫静生成这个图', '給狐宫静生成这个图', '给 狐宫静 的 OC 生成这个图']) assert.equal(isImageGenerationRequest(text), true, text);
  for (const text of ['狐宫静，按原图生成一张', '狐宫静，画初音未来', '不要用狐宫静，照原图生成', '给狐宫静生成这个图，但保留原角色']) assert.equal(requestsHugongjingOc(text), false, text);
});

test('latest live failure and arbitrary subject modifiers always attach the OC instead of guessing by name',async()=>{
  const live='[CQ:at,qq=10011] 给狐宫静随便画个表情包';
  for(const text of [live,'给狐宫静稍微认真一点画个表情包','为狐宫静自由发挥生成头像','用狐宫静的形象尽量照着原图画',
    '给狐宫静'+ '非常开心地'.repeat(12)+'画一张表情包','狐宫静的表情包帮我画一张']){
    assert.equal(requestsHugongjingOc(text),true,text);
    const hasReference=text.includes('原图');
    const result=await prepareGenerationReferences({event:hasReference?{replyContext:{images:[{file:'template'}]}}:{},text,referenceDir,
      prepareImages:async()=>{assert.equal(hasReference,true);return ['/tmp/template.png'];}});
    assert.equal(result.character.imagePaths.length,1,text);
    assert.match(result.character.imagePaths[0],/reference-default.png$/);
    assert.equal(result.identitySelection.useOc,true);assert.match(result.identitySelection.reason,/oc/);
    const prompt=buildNanoBananaPrompt({request:text,referenceCount:result.imagePaths.length,identityCount:result.character.imagePaths.length});
    assert.match(prompt,/本次人物使用狐宫静 OC/);assert.match(prompt,/红眼/);
  }
  assert.equal(resolveGenerationIdentity(live).reason,'oc-subject-before-drawing');
  for(const text of ['狐宫静，随便画个初音未来表情包','狐宫静帮我画一个初音未来','画一张初音未来的图送给狐宫静',
    '给狐宫静随便画个表情包，但不要用狐宫静','狐宫静，参考这个图，保留原角色','画一张猫，标题写狐宫静']){
    assert.equal(requestsHugongjingOc(text),false,text);
  }
});

test('OC replacement attaches identity and template together with distinct roles', async () => {
  for (const event of [{ images: [{ file: 'ref' }] }, { replyContext: { images: [{ file: 'ref' }] } }]) {
    const result = await prepareGenerationReferences({ event, text: '給狐宫静生成这个图', referenceDir, prepareImages: async () => ['/tmp/reference.png'] });
    assert.equal(result.mode, 'hugongjing-oc-reference');
    assert.equal(result.character.imagePaths.length, 1);
    assert.match(result.character.imagePaths[0], /reference-default.png$/);
    assert.ok(result.prompt.includes(`referenced_image_paths: ${JSON.stringify([...result.imagePaths, ...result.character.imagePaths])}`));
    assert.match(result.prompt, /用户原图仅负责动作、表情、构图/);
    assert.match(result.prompt, /浅金发.*红眼/);
    assert.doesNotMatch(result.prompt, /必须保持：原角色身份/);
    assert.doesNotMatch(result.character.prompt, /本次没有自动附加/);
    assert.match(result.character.prompt, /第 2 张是固定基础形象/);
  }
  const missing = await prepareGenerationReferences({ event: {}, text: '给狐宫静生成这个图', referenceDir, prepareImages: () => assert.fail() });
  assert.match(missing.error, /没收到/);
});

test('generation combines current and quoted images, preserving order and removing duplicates', async () => {
  const event = { images: [{ file: 'a', url: 'https://example/a' }], replyContext: { images: [{ file: 'a' }, { file: 'b' }] } };
  assert.deepEqual(collectGenerationReferences(event).map(i => [i.file, i.referenceSource]), [['a', '当前消息'], ['b', '引用消息']]);
  const result = await prepareGenerationReferences({ event, text: '狐宫静，按原图生成一张', referenceDir, prepareImages: async inputs => inputs.map(i => `/tmp/${i.file}.png`) });
  assert.deepEqual(result.imagePaths, ['/tmp/a.png', '/tmp/b.png']);
  assert.deepEqual(result.character.imagePaths, []);
  assert.match(result.prompt, /referenced_image_paths: \["\/tmp\/a.png","\/tmp\/b.png"\]/);
  assert.match(result.prompt, /只执行明确要求的局部变化/);
  assert.match(result.character.prompt, /称呼机器人/);
  assert.doesNotMatch(result.character.prompt, /用户附图仅用于/);
});

test('missing references and partial download fail closed instead of drawing from imagination', async () => {
  const base = { text: '按原图生成一张', referenceDir };
  const missing = await prepareGenerationReferences({ ...base, event: {}, prepareImages: () => assert.fail('must not download') });
  assert.match(missing.error, /没收到/);
  const partial = await prepareGenerationReferences({ ...base, event: { images: [{ file: 'a' }, { file: 'b' }] }, prepareImages: async () => ['/tmp/a.png'] });
  assert.match(partial.error, /没有全部读取成功/);
  assert.equal(partial.character, undefined);
  const tooMany = await prepareGenerationReferences({ ...base, event: { images: [1, 2, 3, 4].map(file => ({ file })) }, prepareImages: () => assert.fail('must not silently truncate') });
  assert.match(tooMany.error, /超过 3 张/);
});

test('no-reference explicit OC generation retains its character; reference edits are recognized', async () => {
  const result = await prepareGenerationReferences({ event: {}, text: '画一张开心的狐宫静表情包', referenceDir, prepareImages: () => assert.fail('no user image') });
  assert.equal(result.character.imagePaths.length, 1);
  assert.equal(result.prompt, '');
  for (const text of ['狐宫静，照这张来一张', '参考这张图生成一张', '复刻原图', '把这张图改成开心的表情', '将原图去掉文字']) assert.equal(isImageGenerationRequest(text), true, text);
});
test('other subjects and objects never load OC assets, even when addressing the bot', async () => {
  for (const text of ['生成高市早苗公主抱特朗普的图', '狐宫静，帮我生成高市早苗公主抱特朗普的图', '画一张初音未来的头像', '生成一张风景图', '制作一张开心的表情包']) {
    const result = await prepareGenerationReferences({event:{},text,referenceDir:'/missing/oc-assets',prepareImages:()=>assert.fail()});
    assert.equal(result.error, undefined, text);
    assert.equal(result.mode, 'requested-subject', text);
    assert.deepEqual(result.character.imagePaths, [], text);
    assert.doesNotMatch(result.character.prompt, /reference-default|reference-summer|固定形象|可信角色基础图/);
    assert.match(result.character.prompt, /身份目标只来自本次原始要求/);
    const spec = buildReferenceSpecPrompt({request:text,references:[],identities:[],sourceOcr:[]});
    assert.match(spec, /本次未选择任何固定 OC 身份图/);
    assert.doesNotMatch(spec, /reference-default/);
  }
});
test('redrawing an explicit OC subject uses built-in identity, while corrections still require the previous image',async()=>{
  for(const text of ['重新画一个白丝狐宫静','给我画一张黑丝狐宫静','画一张狐宫静哈气']){
    const result=await prepareGenerationReferences({event:{},text,referenceDir,prepareImages:()=>assert.fail()});
    assert.equal(result.error,undefined);assert.equal(result.character.imagePaths.length,1);
  }
  for(const text of ['重新画','字生成错了，你重新生成','动作不对，重做','按原图画狐宫静']){
    const result=await prepareGenerationReferences({event:{},text,referenceDir,prepareImages:()=>assert.fail()});
    assert.match(result.error,/没收到/);
  }
});

test('server forwards exact reference paths to CLI and strict prompt; blocked refs never invoke CLI', async () => {
  const source = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function buildModelReply(event)');
  const end = source.indexOf('function limitQqStickerFrequency', start);
  let calls = 0;
  const run = async (download, useOc = false, reviewUnavailable = false, fast = false, subject = null, validation = true,nano = false) => {
    const saved = [];
    const passChecks = Object.fromEntries(qualityCategories.map(k => [k, { status: 'PASS', issue: '', location: '', fix: '', severity: 'minor' }]));
    const detail = { reference: '正确', actual: '正确', status: 'PASS' };
    const reviewValue = { observedText: [], textConfidence: 'high', checks: passChecks,
      poseDetails: Object.fromEntries(['leftHand','rightHand','fingers','leftArm','rightArm','leftLeg','rightLeg','torso','head','relativeObjects'].map(k=>[k,detail])),
      identityDetails: Object.fromEntries(['hairStyle','hairColor','eyes','ears','tailCount','accessories'].map(k=>[k,detail])),
      overallDeviation: 'local', repairSuggestion: '' };
    const sandbox = {
      promptPart,
      qqUsageLedger:{start:()=>({finish:async()=>{},observe(){},write(){}})},
      isLocalTextProvider,isQqHttpTextProvider,qqExplicitWebSearch,qqWebPresearch,attachQqWebSources,qqWebSearchOptOut,currentQqName:()=>"测试角色",protectQqModelIdentity,finishQqVoiceReply, useGeminiText, GEMINI_ROUTER_MODEL,isGeminiTextProvider, limitQqReplyText,qqImageTasks:{run:task=>task()},
      event: { text: subject || (useOc ? '给狐宫静生成这个图' : '狐宫静，按照原图画一张'), images: subject ? [] : [{ file: 'ref.png' }], type: 'group_message' },
      stripMentionText: text => text, isImageGenerationRequest, prepareGenerationReferences,
      localCodexPaths:{incomingImages:'/local/qq-images'}, mayRetryMissingImage, buildMissingImageRetryPrompt,readImageReferenceWithRetry,formatImagePreflightFailure,
      buildReferenceSpecPrompt, parseReferenceSpec, buildDetailedReviewPrompt, buildTextConfirmationPrompt, validateGeneratedImages, imageTaskArgs, visualGroundingPrompt, selectQqImageModel,
      ocrImage: async () => ({words:[],text:'',confidence:1}),
      writeValidationReport: async (_dir,report) => { saved.push(structuredClone(report)); return '/data/report.json'; },
      readFile: async path => path.includes('reference-spec')
        ? JSON.stringify({expectedText:[],textConfidence:'high',pose:'双手背后',identity:'原图或OC',props:'无',composition:'竖版',constraints:[]})
        : reviewUnavailable ? '{}' : JSON.stringify(reviewValue),
      prepareQqModelImages: download, fetchOneBotImage() {}, qqCharacterDir: referenceDir,
      projectDir: '/project', dataDir: '/data', qqGeneratedArchiveDir: '/images', codexTmpDir: '/replies', codexWorkspaceDir: '/workspace',
      join: (...parts) => parts.join('/'), crypto: { randomUUID: () => 'test' }, process: { env: {} },
      formatQuotedContext: () => '', formatMemoryContext: () => '', formatQqPersonaContext: () => '',
      state: { ai: { model: 'gpt-6-luna', reasoningEffort: 'low',qqFastMode:fast,qqImageValidation:validation,qqImageProvider:nano?'nano-banana-2':'codex-cli' }, qq: { enhancer: { enabled: false } } },
      hasAnyQqImageReference: () => true, formatQqImageSummary: () => '1 张', formatQqStickerCatalog: () => '',
      buildAssistantInstructions: async () => {assert.equal(nano,false,'Nano Banana must bypass chat persona and history prompts');return '';}, ensureCodexReplyWorkspace: async () => {},
      codexHomeDir:'/codex',buildNanoBananaPrompt,selectNanoBananaSize,NANO_BANANA_MODEL,
      archiveQqImagesSafely:async options=>{
        assert.equal(nano,true);assert.equal(options.sourceRoot,'/codex/generated_images/nano-banana-2');
        assert.equal(options.threadId,'test');assert.equal(options.context.model,NANO_BANANA_MODEL);
        assert.deepEqual(Array.from(options.files),['/generated/output.png']);
        return {ok:true,directory:options.directory,count:1};
      },
      readNanoBananaDimensions:async()=>({width:600,height:900}),
      generateNanoBanana:async({prompt,references,size,onRequest})=>{
        assert.equal(nano,true);
        if(subject){
          assert.equal(size,undefined,'OC sheet dimensions must not set the output aspect ratio');
          assert.equal(references.length,1);assert.match(references[0],/reference-default.png$/);
          assert.match(prompt,/本次用户要求：给狐宫静随便画个表情包/);assert.match(prompt,/图 1 是狐宫静的 OC/);
        }else{
          assert.equal(size,'1024x1536');assert.equal(references.length,2);assert.equal(references[0],'/tmp/reference.png');
          assert.match(references[1],/reference-default.png$/);assert.match(prompt,/图 2 是狐宫静的 OC/);
        }
        assert.doesNotMatch(prompt,/image_gen|qq_context_more|网警|别惹我/);
        await onRequest({prompt,referenceCount:references.length});return ['/generated/output.png'];
      },
      runCodexCli: async (args, prompt, options) => {
        assert.equal(args[args.indexOf('-m') + 1], 'gpt-6-luna');
        assert.equal(args.includes('service_tier="fast"'),fast);
        assert.equal(args.includes('features.fast_mode=true'),fast);
        if (options.captureImages === false) {
          assert.equal(validation,true,'direct-send mode must not invoke preflight or quality review');
          assert.ok(args.includes('--disable'));
          assert.match(prompt, /独立验收准备|独立图片验收员/);
          if (subject) {
            assert.equal(args.includes('--image'), /image-review/.test(args.join(' ')));
            assert.doesNotMatch(args.join(' '), /reference-default/);
            assert.match(prompt, /生成高市早苗公主抱特朗普的图/);
          }
          return {};
        }
        calls++;
        const identity = fileURLToPath(new URL('../assets/qq-character/hugongjing/reference-default.png', import.meta.url));
        const paths = [...(subject ? [] : ['/tmp/reference.png']), ...(useOc ? [identity] : [])];
        if (subject) {
          assert.equal(args.includes('--image'), false);
          assert.doesNotMatch(prompt, /reference-default|可信角色基础图/);
          assert.match(prompt, /生成高市早苗公主抱特朗普的图/);
        } else {
          assert.deepEqual(Array.from(args.slice(args.indexOf('--image'))), [...paths.flatMap(p => ['--image', p]), '-']);
          assert.ok(prompt.includes(`referenced_image_paths: ${JSON.stringify(paths)}`));
        }
        assert.equal(options.imageArchive.context.referenceMode, subject ? 'requested-subject' : useOc ? 'hugongjing-oc-reference' : 'user-reference-strict');
        assert.equal(options.imageArchive.context.model, 'gpt-6-luna');
        assert.deepEqual(Array.from(options.imageArchive.context.identityReferencePaths), useOc ? [identity] : []);
        return { generatedImages: ['/generated/output.png'] };
      },
      generatedImageReply: () => 'generated'
    };
    const reply = await vm.runInNewContext(source.slice(start, end) + '\nbuildModelReply(event)', sandbox);
    if(nano&&subject){
      assert.equal(saved.at(-1).identitySelection.reason,'oc-subject-before-drawing');
      assert.equal(saved.at(-1).identityPaths.length,1);
      assert.deepEqual(Array.from(saved.at(-1).generationRequest.referenceRoles),['oc-identity']);
    }
    if (!reviewUnavailable && download.length !== 0) assert.ok(saved.some(r=>r.status===(validation?'passed':'ready-unvalidated')));
    return reply;
  };
  assert.equal(await run(async () => ['/tmp/reference.png']), 'generated');
  assert.equal(await run(async () => ['/tmp/reference.png'], true), 'generated');
  assert.equal(await run(async () => ['/tmp/reference.png'], true, false, true), 'generated');
  assert.equal(await run(()=>assert.fail('no user images'), false, false, true, '生成高市早苗公主抱特朗普的图'), 'generated');
  assert.match(await run(async () => ['/tmp/reference.png'], true, true), /验收还没通过/);
  assert.match(await run(async () => []), /没有全部读取成功/);
  assert.equal(await run(async()=>['/tmp/reference.png'],true,false,false,null,false),'generated');
  assert.equal(await run(async()=>['/tmp/reference.png'],true,false,false,null,false,true),'generated');
  assert.equal(await run(()=>assert.fail('no user image needed'),true,false,false,'给狐宫静随便画个表情包',false,true),'generated');
  assert.equal(calls, 6);
});
