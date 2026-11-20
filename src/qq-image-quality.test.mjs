import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReferenceSpec,parseImageReview, reviewAndRepairImages, imageTaskArgs, buildVisualEvidencePrompt, selectQqImageModel,
  qualityCategories, parseDetailedReview, applyTextConfirmation, planImageRepair, buildRepairPrompt, validateGeneratedImages } from './qq-image-quality.mjs';
import { prepareGenerationReferences } from './qq-generation.mjs';
import { isImageGenerationRequest } from './qq-codex-images.mjs';

const row = (extra = {}) => ({ index: 0, readable: true, expectedText: ['网警巡视中...'], actualText: ['网警巡视中...'], sourcePose: '双手背在身后', actualPose: '双手背在身后', poseOk: true, identityOk: true, layoutOk: true, issues: [], ...extra });
const report = r => JSON.stringify({ results: [r] });

test('visual routing honors Luna without upgrading it, and preserves other selected models', () => {
  for(const model of ['gpt-6-luna','gpt-5.6-luna','gpt-6.1-sol','gpt-6-sol','gpt-6-astra','gpt-5.5','custom-model']) assert.equal(selectQqImageModel(model),model);
});

test('literal text mismatch cannot pass even when the model claims the pose is correct', () => {
  assert.equal(parseImageReview(report(row()), 1)[0].accepted, true);
  assert.equal(parseImageReview(report(row({ actualText: ['别惹我...'] })), 1)[0].accepted, false);
  assert.equal(parseImageReview(report(row({ actualText: ['网警巡视中'] })), 1)[0].accepted, false);
  assert.equal(parseImageReview(report(row({ poseOk: false, actualPose: '胸前抱臂' })), 1)[0].accepted, false);
  assert.equal(parseImageReview(report(row({ readable: false })), 1)[0].accepted, false);
  assert.equal(parseImageReview(report(row({ expectedText: [], actualText: [] })), 1)[0].accepted, true);
  assert.equal(parseImageReview(report(row({ expectedText: ['新文案'], actualText: ['新文案'] })), 1)[0].accepted, true);
});

test('malformed, incomplete and duplicate reviews fail closed', () => {
  for (const text of ['looks good', '{}', report({ index: 0 }), report(row({ poseOk: 'true' })), report(row({ index: 9 })), JSON.stringify({results:[row(),row()]})]) assert.equal(parseImageReview(text, 1), null);
});

test('one repair maximum and only a verified image is returned', async () => {
  let reviews = 0, repairs = 0;
  const result = await reviewAndRepairImages({ initial: ['bad'], review: async paths => { reviews++; return report(row({ actualText: paths[0] === 'bad' ? ['别惹我...'] : ['网警巡视中...'] })); }, repair: async () => { repairs++; return ['good']; } });
  assert.deepEqual(result.paths, ['good']); assert.equal(reviews, 2); assert.equal(repairs, 1);
  reviews = 0; repairs = 0;
  const failed = await reviewAndRepairImages({ initial: ['bad'], review: async () => { reviews++; return report(row({poseOk:false})); }, repair: async () => {repairs++; return ['still-bad'];} });
  assert.deepEqual(failed.paths, []); assert.equal(reviews, 2); assert.equal(repairs, 1);
});

test('unreadable text, review failures and repair failures never deliver unchecked candidates', async () => {
  for(const response of ['invalid', report(row({readable:false}))]) {
    const r = await reviewAndRepairImages({initial:['bad'], review:async()=>response, repair:()=>assert.fail('must not guess')});
    assert.deepEqual(r.paths, []);
  }
  const r = await reviewAndRepairImages({initial:['bad'], review:async()=>report(row({poseOk:false})), repair:async()=>{throw new Error('tool unavailable');}});
  assert.deepEqual(r.paths, []);
});

test('only passing candidates delivered when a turn generated multiple images', async () => {
  const r = await reviewAndRepairImages({initial:['bad','good'], review:async()=>JSON.stringify({results:[row({poseOk:false}),row({index:1})]}),repair:()=>assert.fail()});
  assert.deepEqual(r.paths,['good']);
});

test('review disables image generation and replaces inputs/output without weakening sandbox', () => {
  const args = imageTaskArgs(['exec','--enable','image_generation','-s','read-only','-m','gpt-6-luna','-o','old','--image','old.png','-'], ['new.png'], 'review.json', {review:true});
  assert.deepEqual(args,['exec','--disable','image_generation','-s','read-only','-m','gpt-6-luna','-o','review.json','--image','new.png','-']);
  const prompt = buildVisualEvidencePrompt(['current.png']);
  assert.match(prompt,/不把历史聊天/); assert.match(prompt,/无法辨清.*不确定/); assert.match(prompt,/仍遵守正常安全规则/);
});

test('short correction requests use generation route but missing reference never triggers blind redraw', async () => {
  for(const text of ['字生成错了，你重新生成','重新画','动作不对，重做']) assert.equal(isImageGenerationRequest(text),true,text);
  const r = await prepareGenerationReferences({event:{},text:'字生成错了，你重新生成',referenceDir:'/unused',prepareImages:()=>assert.fail()});
  assert.match(r.error,/没收到/);
});

const goodCheck = () => ({status:'PASS',issue:'',location:'',fix:'',severity:'minor'});
const detail = () => ({reference:'正确',actual:'正确',status:'PASS'});
function detailed(overrides = {}) {
  return {observedText:['网警巡视中...'],textConfidence:'high',checks:Object.fromEntries(qualityCategories.map(k=>[k,goodCheck()])),
    poseDetails:Object.fromEntries(['leftHand','rightHand','fingers','leftArm','rightArm','leftLeg','rightLeg','torso','head','relativeObjects'].map(k=>[k,detail()])),
    identityDetails:Object.fromEntries(['hairStyle','hairColor','eyes','ears','tailCount','accessories'].map(k=>[k,detail()])),
    overallDeviation:'local',repairSuggestion:'只修错误位置，其余保持',...overrides};
}
const expected = {expectedText:['网警巡视中...'],textConfidence:'high',pose:'双手背后',identity:'狐宫静',props:'无',composition:'竖版'};
const highOcr = {text:'网警巡视中...',confidence:0.95};

test('reference preparation cannot invent a standing pose or framing from an OC sheet',()=>{
  const raw={...expected,pose:'正面站立，双手张开，双腿并拢',constraints:[{category:'pose',value:'正面站立',source:'identity',evidence:'身份图姿势'},{category:'composition',value:'正面全身',source:'request',evidence:'编造的用户引文'}]};
  const free=parseReferenceSpec(JSON.stringify(raw),{request:'画狐宫静开小店',references:[],identities:['oc.png']});
  assert.match(free.pose,/自由设计/);assert.match(free.composition,/自由设计/);
  raw.constraints.push({category:'pose',value:'左手挥手',source:'request',evidence:'左手挥手'});
  const explicit=parseReferenceSpec(JSON.stringify(raw),{request:'画狐宫静左手挥手',references:[],identities:['oc.png']});
  assert.match(explicit.pose,/左手挥手/);assert.doesNotMatch(explicit.pose,/正面站立/);
  assert.equal(parseReferenceSpec(JSON.stringify(expected),{request:'按图',references:['ref'],identities:[]}),null,'incomplete schema gets retried rather than silently dropping requirements');
});

test('target text is compared separately from other sign lettering, without allowing real typos',()=>{
  const menu={...expected,expectedText:['冰大份','冰激凌','冰芭乐']};
  const raw=detailed({observedText:['江姐食店','冰大份','冰激凌','冰芭乐','售完'],targetText:['冰大份','冰激凌','冰芭乐'],incidentalText:['江姐食店','售完']});
  const ocr={confidence:.95,text:'冰大份冰激凌冰芭乐'};
  assert.equal(parseDetailedReview(JSON.stringify(raw),{expected:menu,sourceOcr:ocr,candidateOcr:ocr}).accepted,true);
  raw.targetText[1]='冰激灵';raw.observedText[2]='冰激灵';
  assert.equal(parseDetailedReview(JSON.stringify(raw),{expected:menu,sourceOcr:ocr,candidateOcr:ocr}).checks.text.status,'FAIL');
  raw.targetText[1]='冰激凌';assert.equal(parseDetailedReview(JSON.stringify(raw),{expected:menu,sourceOcr:ocr,candidateOcr:ocr}),null,'cannot invent correct text absent from visual observations');
});

test('validation retries transient failures and invalid JSON on the same image, never redrawing it',async()=>{
  for(const mode of ['network','json','auth']){
    let reads=0;const r=await validateGeneratedImages({report:{identityPaths:[],referencePaths:[],originalRequest:'原图'},candidates:['candidate'],expected,sourceOcr:[highOcr],readOcr:async()=>highOcr,persist:async()=>{},wait:async()=>{},
      review:async({candidate,readRetry})=>{assert.equal(candidate,'candidate');reads++;if(mode==='auth')throw new Error('403 authentication');if(reads===1){if(mode==='json')return 'broken';throw new Error('ECONNRESET')}assert.equal(readRetry.attempt,2);return JSON.stringify(detailed())},repair:()=>assert.fail('read-only retry must not regenerate')});
    assert.equal(reads,mode==='auth'?1:2);assert.equal(r.reason,mode==='auth'?'review-unavailable':'passed');assert.equal(r.report.validationAttempts.length,reads);
  }
});

test('uncertain OCR noise on a text-free image is independently rechecked, not blindly blocked',async()=>{
  const first=detailed({observedText:[]});first.checks.text={status:'UNCERTAIN',issue:'无字图片上的 OCR 噪声',location:'背景',fix:'',severity:'minor'};
  const second=detailed({observedText:[]});second.checks.text={...goodCheck(),status:'SKIP'};let calls=0;
  const r=await validateGeneratedImages({report:{identityPaths:[],referencePaths:[],originalRequest:'无文字头像'},candidates:['candidate'],expected:{...expected,expectedText:[]},sourceOcr:[],readOcr:async()=>({text:'noise',confidence:0}),persist:async()=>{},wait:async()=>{},
    review:async()=>JSON.stringify(++calls===1?first:second),repair:()=>assert.fail()});
  assert.equal(calls,2);assert.equal(r.reason,'passed');assert.ok(r.report.rounds[0].entries[0].uncertaintyConfirmation);
});

test('final failure requires a complete fresh visual review and still blocks confirmed errors',async()=>{
  for(const resolved of [true,false]){
    const first=detailed();first.checks.props={status:'FAIL',issue:'菜单纵向阅读不明确',location:'菜单',fix:'核对原始要求',severity:'major'};let calls=0;
    const r=await validateGeneratedImages({report:{identityPaths:[],referencePaths:['reference'],originalRequest:'按原图'},candidates:['candidate'],expected,sourceOcr:[highOcr],readOcr:async()=>highOcr,persist:async()=>{},wait:async()=>{},maxRetries:0,confirmFinalFailure:true,
      review:async({confirmationReview})=>{calls++;if(calls===1)return JSON.stringify(first);assert.equal(confirmationReview.checks.props.status,'FAIL');return JSON.stringify(resolved?detailed():first)},repair:()=>assert.fail()});
    assert.equal(calls,2);assert.equal(r.reason,resolved?'passed':'failed');assert.ok(r.report.rounds[0].entries[0].finalFailureConfirmation);
  }
});

test('an independently corrected false failure does not trigger an unnecessary image edit',async()=>{
  const first=detailed();first.checks.composition={status:'FAIL',issue:'未要求的站姿',location:'全图',fix:'站直',severity:'major'};let calls=0;
  const r=await validateGeneratedImages({report:{identityPaths:[],referencePaths:[],originalRequest:'自由动作'},candidates:['candidate'],expected,sourceOcr:[highOcr],readOcr:async()=>highOcr,persist:async()=>{},wait:async()=>{},confirmBeforeRepair:true,
    review:async({confirmationReview})=>{if(++calls===1)return JSON.stringify(first);assert.equal(confirmationReview.checks.composition.status,'FAIL');return JSON.stringify(detailed())},repair:()=>assert.fail('do not edit a visually confirmed correct image')});
  assert.equal(calls,2);assert.equal(r.reason,'passed');assert.equal(r.report.rounds.length,1);
});

test('seven failure categories and detailed left/right limbs override broad PASS', () => {
  const raw = detailed();
  raw.poseDetails.leftHand = {reference:'背后',actual:'胸前',status:'FAIL'};
  raw.poseDetails.fingers = {reference:'自然',actual:'六指',status:'FAIL'};
  raw.identityDetails.tailCount = {reference:'一条',actual:'两条',status:'FAIL'};
  raw.checks.anatomy = {status:'FAIL',issue:'右手六指',location:'右手',fix:'仅修正手指数量',severity:'minor'};
  raw.checks.clothing = {status:'FAIL',issue:'制服配色错误',location:'上衣',fix:'换回蓝白',severity:'minor'};
  raw.checks.props = {status:'FAIL',issue:'道具在错误侧',location:'左肩',fix:'移动道具',severity:'minor'};
  raw.checks.composition = {status:'FAIL',issue:'人物被截断',location:'腿部',fix:'恢复画幅',severity:'major'};
  const review = parseDetailedReview(JSON.stringify(raw),{expected,sourceOcr:highOcr,candidateOcr:highOcr,identities:['oc.png']});
  assert.equal(review.checks.pose.status,'FAIL'); assert.equal(review.checks.identity.status,'FAIL');
  assert.equal(review.checks.anatomy.status,'FAIL'); assert.equal(review.checks.clothing.status,'FAIL');
  assert.equal(review.checks.props.status,'FAIL'); assert.equal(review.checks.composition.status,'FAIL');
  assert.equal(review.accepted,false);
});

test('low-confidence OCR gets Sol confirmation and can accept a correct image', () => {
  const raw = detailed();
  const review = parseDetailedReview(JSON.stringify(raw),{expected,sourceOcr:{text:'N=网警',confidence:0.44},candidateOcr:{text:'网警',confidence:0.51},identities:['oc.png']});
  assert.equal(review.checks.text.status,'UNCERTAIN'); assert.equal(review.needsTextConfirmation,true);
  applyTextConfirmation(review,JSON.stringify({status:'PASS',expectedText:expected.expectedText,actualText:expected.expectedText,reason:'放大后文字一致'}),expected);
  assert.equal(review.checks.text.status,'PASS'); assert.equal(review.accepted,true);
  const bad = parseDetailedReview(JSON.stringify(detailed({observedText:['别惹我...']})),{expected,sourceOcr:highOcr,candidateOcr:highOcr,identities:['oc.png']});
  assert.equal(bad.checks.text.status,'FAIL');
});
test('occlusion uncertainty receives a second visual review, retains evidence and never triggers a blind redraw',async()=>{
  const first=detailed();first.checks.anatomy={status:'UNCERTAIN',issue:'另一只手被挡住',location:'右下角',fix:'',severity:'minor'};
  first.poseDetails.rightHand={reference:'未要求露出',actual:'正常遮挡',status:'SKIP'};
  const second=detailed();second.poseDetails.rightHand=first.poseDetails.rightHand;
  for(const resolved of [true,false]){
    const report={id:'00000000-0000-4000-8000-000000000001',originalRequest:'可爱表情包',referencePaths:[],identityPaths:['oc.png']};
    let count=0;
    const result=await validateGeneratedImages({report,candidates:['/generated.png'],expected,sourceOcr:[highOcr],readOcr:async()=>highOcr,persist:async()=>{},
      review:async({candidate,confirmationReview})=>{
        assert.equal(candidate,'/generated.png');count++;
        if(count===1)return JSON.stringify(first);
        assert.equal(confirmationReview.checks.anatomy.status,'UNCERTAIN');
        return JSON.stringify(resolved?second:first);
      },repair:()=>assert.fail('unresolved uncertainty must not cause a redraw')});
    assert.equal(count,2);
    assert.equal(result.reason,resolved?'passed':'uncertain');
    assert.equal(report.rounds[0].entries[0].uncertaintyConfirmation.firstReview.checks.anatomy.status,'UNCERTAIN');
    assert.equal(report.rounds[0].entries[0].retry,false);
  }
});

test('repair plan targets only new failures and preserves previously corrected hand', () => {
  const first = detailed(); first.checks.pose={status:'FAIL',issue:'左手在胸前',location:'左手',fix:'移到身后',severity:'major'};
  const second = detailed({observedText:['别惹我...']}); second.checks.text={status:'FAIL',issue:'文字错',location:'下方文字',fix:'改成网警巡视中...',severity:'major'};
  const p=planImageRepair(second,[first]);
  assert.equal(p.mode,'edit'); assert.deepEqual(p.failures,['text']); assert.ok(p.preserved.includes('pose'));
  const prompt=buildRepairPrompt({request:'保留原图',referencePaths:['ref.png'],identityPaths:['oc.png'],candidate:'second.png',expected,review:second,plan:p,previousReviews:[first]});
  assert.match(prompt,/左手/); assert.match(prompt,/不得修坏/); assert.match(prompt,/文字错/);
  assert.match(prompt,/\["second.png","ref.png","oc.png"\]/);
  const severe=detailed({overallDeviation:'severe'}); severe.checks.composition={status:'FAIL',issue:'整幅错',location:'全图',fix:'重做',severity:'major'};
  assert.equal(planImageRepair(severe).mode,'regenerate');
});

test('orchestrator persists each round and second retry only fixes the remaining text', async () => {
  const saved=[],repairCalls=[];
  const first=detailed(); first.checks.pose={status:'FAIL',issue:'左手反了',location:'左手',fix:'手背到后面',severity:'major'};
  first.poseDetails.leftHand={reference:'背后',actual:'胸前',status:'FAIL'};
  const second=detailed({observedText:['别惹我...']}); second.checks.text={status:'FAIL',issue:'文案错',location:'下方',fix:'改回网警巡视中...',severity:'major'};
  const results=[first,second,detailed()];let index=0;
  const report={id:'123e4567-e89b-12d3-a456-426614174000',originalRequest:'给狐宫静生成这个图',referencePaths:['ref.png'],identityPaths:['oc.png']};
  const output=await validateGeneratedImages({report,candidates:['first.png'],expected,sourceOcr:[highOcr],
    readOcr:async()=>highOcr,
    review:async()=>JSON.stringify(results[index++]),
    confirmText:async()=>JSON.stringify({status:'PASS',expectedText:expected.expectedText,actualText:expected.expectedText,reason:'一致'}),
    repair:async action=>{repairCalls.push(action);return [repairCalls.length===1?'second.png':'third.png'];},
    persist:async r=>saved.push(structuredClone(r))});
  assert.deepEqual(output.paths,['third.png']); assert.equal(report.rounds.length,3);
  assert.equal(report.rounds[0].entries[0].checks.pose.status,'FAIL');
  assert.equal(report.rounds[1].entries[0].checks.text.status,'FAIL');
  assert.match(repairCalls[0].prompt,/左手反了/);
  assert.deepEqual(repairCalls[1].plan.failures,['text']);
  assert.match(repairCalls[1].prompt,/不得修坏/);
  assert.equal(saved.at(-1).status,'passed'); assert.equal(saved.at(-1).rounds.length,3);
});

test('contradictory identity verdict is visually rechecked instead of editing correct red eyes', async () => {
  const first=detailed(); first.checks.identity={status:'FAIL',issue:'要求红眼，成品红眼',location:'眼睛',fix:'改为红眼',severity:'major'};
  first.identityDetails.eyes={reference:'红眼',actual:'红眼',status:'PASS'};
  const parsed=parseDetailedReview(JSON.stringify(first),{expected,sourceOcr:highOcr,candidateOcr:highOcr});
  assert.equal(parsed.checks.identity.status,'UNCERTAIN');assert.equal(parsed.accepted,false);
  assert.equal(parsed.reviewInconsistencies[0].category,'identity');
  let calls=0;
  const result=await validateGeneratedImages({report:{identityPaths:['oc'],referencePaths:[],originalRequest:'画狐宫静'},candidates:['real-image'],expected,sourceOcr:[highOcr],readOcr:async()=>highOcr,persist:async()=>{},
    review:async({confirmationReview})=>{calls++;if(calls===1)return JSON.stringify(first);assert.ok(confirmationReview.reviewInconsistencies.length);return JSON.stringify(detailed());},
    repair:()=>assert.fail('a contradictory verdict must not edit correct features')});
  assert.equal(calls,2);assert.deepEqual(result.paths,['real-image']);
});

test('identical text with contradictory FAIL is uncertain until a fresh visual confirmation', async () => {
  const raw=detailed();raw.checks.text={status:'FAIL',issue:'字形不同',location:'文字',fix:'修字',severity:'major'};
  const parsed=parseDetailedReview(JSON.stringify(raw),{expected,sourceOcr:highOcr,candidateOcr:highOcr});
  assert.equal(parsed.needsTextConfirmation,true);
  const contradiction={status:'FAIL',expectedText:expected.expectedText,actualText:expected.expectedText,reason:'相同但判错'};
  applyTextConfirmation(parsed,JSON.stringify(contradiction),expected);
  assert.equal(parsed.checks.text.status,'UNCERTAIN');assert.equal(parsed.accepted,false);
  let count=0;
  const result=await validateGeneratedImages({report:{identityPaths:[],referencePaths:[],originalRequest:'保留文字'},candidates:['image'],expected,sourceOcr:[highOcr],readOcr:async()=>highOcr,persist:async()=>{},review:async()=>JSON.stringify(raw),
    confirmText:async({confirmationReview})=>{count++;if(count===1)return JSON.stringify(contradiction);assert.deepEqual(confirmationReview,contradiction);return JSON.stringify({...contradiction,status:'PASS',reason:'重新看图后确认一致'});},repair:()=>assert.fail()});
  assert.equal(count,2);assert.equal(result.reason,'passed');assert.ok(result.report.rounds[0].entries[0].review.textConfirmationRecheck);
});

test('text confirmation cannot pass a real typo or malformed arrays',()=>{
  const parsed=parseDetailedReview(JSON.stringify(detailed()),{expected,sourceOcr:{confidence:0},candidateOcr:{confidence:0}});
  applyTextConfirmation(parsed,JSON.stringify({status:'PASS',expectedText:expected.expectedText,actualText:['网警巡似中...'],reason:'差不多'}),expected);
  assert.equal(parsed.checks.text.status,'FAIL');assert.equal(parsed.accepted,false);
  const before=structuredClone(parsed);
  applyTextConfirmation(parsed,JSON.stringify({status:'PASS',expectedText:[{}],actualText:[{}],reason:'bad'}),expected);
  assert.deepEqual(parsed,before);
});

test('an uncertain background does not stop a verified local hand repair and never permits unverified delivery', async()=>{
  const first=detailed();first.checks.text={status:'UNCERTAIN',issue:'背景招牌看不清',location:'背景',fix:'',severity:'minor'};
  first.checks.pose={status:'FAIL',issue:'左手反了',location:'左手',fix:'只把左手改为挥手',severity:'major'};
  first.poseDetails.leftHand={reference:'挥手',actual:'握拳',status:'FAIL'};
  const noText={...expected,expectedText:[]};first.observedText=[];
  let repairs=0;
  for(const finalUncertain of [false,true]){
    const second=detailed({observedText:[]});if(finalUncertain)second.checks.text=first.checks.text;
    const result=await validateGeneratedImages({report:{identityPaths:[],referencePaths:['ref'],originalRequest:'按图画'},candidates:['first'],expected:noText,sourceOcr:[],readOcr:async()=>({text:'',confidence:0}),persist:async()=>{},
      review:async({candidate})=>JSON.stringify(candidate==='first'?first:second),
      repair:async({plan,prompt})=>{repairs++;assert.deepEqual(plan.failures,['pose']);assert.deepEqual(plan.unresolved,['text']);assert.match(prompt,/不可猜测或顺便改动/);return ['fixed'];}});
    assert.equal(result.reason,finalUncertain?'uncertain':'passed');assert.deepEqual(result.paths,finalUncertain?[]:['fixed']);
  }
  assert.equal(repairs,2);
});
