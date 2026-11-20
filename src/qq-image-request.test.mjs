import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {parseQqImageRequest} from './qq-image-request.mjs';
import {prepareGenerationReferences} from './qq-generation.mjs';
import {isImageGenerationRequest} from './qq-codex-images.mjs';
import {buildNanoBananaPrompt} from './qq-nanobanana.mjs';
import {useGeminiText} from './qq-text-context.mjs';
const referenceDir=fileURLToPath(new URL('../assets/qq-character/hugongjing/',import.meta.url));

test('declarative subject after an image-job header always loads the OC, without needing a second drawing verb',async()=>{
  for(const request of ['生图，狐宫静双手握拳，两眼紧闭，躺在沙发上','生图，狐宫静坐直升机','生图：狐宫静穿白蓝水手服，开心挥手',
    '生成图片，狐宫静站在花园里','[CQ:at,qq=10011] 生图，狐宫静双手握拳']){
    const intent=parseQqImageRequest(request);assert.equal(intent.requested,true,request);assert.equal(intent.identity.useOc,true,request);
    const generation=await prepareGenerationReferences({event:{},text:request,referenceDir,prepareImages:()=>assert.fail('no user image')});
    assert.equal(generation.character.imagePaths.length,1,request);
    const prompt=buildNanoBananaPrompt({request,identityCount:1,identityDescription:generation.character.appearance});
    assert.match(prompt,/画面右侧（角色左侧）/);assert.match(prompt,/金色铃铛/);assert.match(prompt,/一条蓬松/);
    assert.doesNotMatch(prompt,/originals\/|image_gen|reference-default\.png|生图使用规则|可信角色基础图/);
  }
});
test('questions about drawing must not schedule or charge for a generated picture',()=>{
  for(const text of ['你为什么用gemini生图就乱跑','为什么狐宫静生图不按设定来','生图是不是坏了总是不出图',
    '怎么生成狐宫静的图片','如何画狐宫静','Gemini 生图失败了','你画的图为什么不一样','他用 gemini 生图就不按照设定来，gpt 的就正常，有没有办法解决这个问题']){
    const intent=parseQqImageRequest(text);assert.equal(intent.kind,'discussion',text);assert.equal(isImageGenerationRequest(text),false,text);
    assert.equal(intent.identity.useOc,false,text);
  }
});
test('negative drawing clauses and quoted image commands cannot send a read-only photo request to generation',()=>{
  for(const text of ['只看这张引用图片，描述主体和符号。不要生图或发送消息。','狐宫静，只看图，不要生成图片','这次不要画图，只解释照片','图片上写着“生图”，这是什么意思','先不画，等我给参考图'])assert.equal(isImageGenerationRequest(text),false,text);
  for(const text of ['不要修改原图，画一张新的狐宫静','画个写着“不要生图”的表情包','只生成一张猫，不要画狐宫静'])assert.equal(isImageGenerationRequest(text),true,text);
});
test('real drawing requests still work with questions in the requested caption or explicit retries',()=>{
  for(const text of ['画一张狐宫静，文字写“为什么”','画一个写着“生图失败”的表情包','帮我生成一张图','能不能画一张狐宫静',
    '生图失败了，重新生成一张狐宫静','给狐宫静随便画个表情包','用狐宫静模仿原图'])assert.equal(isImageGenerationRequest(text),true,text);
  for(const text of ['狐宫静，画一张初音未来','生图，初音未来坐直升机','生图，狐宫静，帮我画一只猫'])assert.equal(parseQqImageRequest(text).identity.useOc,false,text);
});
test('ordinary replies cannot invoke the Codex image generator merely because drawing was discussed',async()=>{
  const source=await readFile(new URL('./server.js',import.meta.url),'utf8');
  assert.ok(source.includes("...(imageRequested ? ['--enable','image_generation'] : ['--disable','image_generation'])"));
});
test('long descriptions after a custom call-name route to image jobs rather than Gemini text and do not attach the OC',()=>{
  for(const request of ['狐狐生成一张高市早苗公主抱特朗普的照片',
    '静静帮我制作一张城市街头雨后灯光照在玻璃窗上映出很远处星空的照片',
    '请创作一张'+ '有花草的小院子和窗边的猫咪'.repeat(8)+'的插画']){
    const intent=parseQqImageRequest(request);
    assert.equal(intent.requested,true,request);assert.equal(intent.identity.useOc,false,request);
    assert.equal(useGeminiText({provider:'gemini-3.8flash',imageRequested:intent.requested}),false);
  }
  for(const request of ['为什么生成一张高市早苗公主抱特朗普的照片没有成功',
    '狐狐怎么生成一张城市街头雨后灯光照在玻璃窗上映出星空的照片']){
    assert.equal(parseQqImageRequest(request).kind,'discussion',request);
  }
});
