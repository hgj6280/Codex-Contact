import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialAnalysis} from './qq-social-analysis.mjs';
import {normalizeStickerOutput} from './qq-sticker-output.mjs';
import {repairLocalChatPlan,validLocalChatPlan} from './qq-local-model.mjs';
const catalog=[{name:'乖乖摸头.webp'},{name:'乖巧站好.webp'}];
test('only enabled exact catalog filenames become attachment markers, no paths or disabled names',()=>{
 for(const value of ['（乖乖摸头.webp）','(乖乖摸头.webp)','乖乖摸头.webp'])assert.equal(normalizeStickerOutput(value,catalog),'[[qq_sticker:乖乖摸头.webp]]');
 assert.equal(normalizeStickerOutput('嗯～(乖巧站好.webp) 好啦',catalog),'嗯～ 好啦\n[[qq_sticker:乖巧站好.webp]]');
 for(const value of ['(惊讶.webp)','(/etc/passwd.png)','不是表情只是说webp','[[qq_sticker:乖巧站好.webp]]'])assert.equal(normalizeStickerOutput(value,catalog),value);
});
test('local social planning ignores a broken Gemini route and records real local usage; cloud retains original behavior',async()=>{
 let provider='local-qwen35-4b',cloud=0,local=0,available=0;const records=[];
 const analyze=createSocialAnalysis({provider:()=>provider,localReply:async(p,o)=>{local++;assert.equal(o.maxTokens,450);assert.equal(o.priority,'background');return {text:'{"messages":["你好"]}',usage:{available:true,prompt_tokens:12,completion_tokens:4}};},remoteReply:async()=>{cloud++;return {text:'remote'};},ledger:{start:model=>({write:s=>records.push({model,data:JSON.parse(s)}),finish:async()=>{}})},noteAvailable:()=>available++,noteUnavailable:()=>assert.fail('local must not trip Gemini health')});
 await analyze('同一会话');assert.equal(local,1);assert.equal(cloud,0);assert.equal(available,0);assert.equal(records[0].model,'local-qwen35-4b');
 provider='gemini-3.8flash';await analyze('同一会话');assert.equal(cloud,1);assert.equal(available,1);
});
test('one bounded structural repair keeps original protocol, includes attention constraint, and sums usage',async()=>{
 let calls=0;const repaired=await repairLocalChatPlan({text:'随便说一句',durationMs:10,usage:{available:true,prompt_tokens:8,completion_tokens:3}},{prompt:'可信宿主权限和当前会话',contextual:true,reply:async(p,o)=>{calls++;assert.match(p,/可信宿主权限和当前会话/);assert.match(p,/attention/);assert.equal(o.maxTokens,512);return {text:'{"mode":"reply","reply":"先说一句。\\n\\n再补一点。","actions":[]}',durationMs:20,usage:{available:true,prompt_tokens:12,completion_tokens:7}};}});
 assert.equal(calls,1);assert.equal(repaired.durationMs,30);assert.equal(repaired.usage.prompt_tokens,20);assert.equal(repaired.protocolRepair.valid,true);
 assert.ok(validLocalChatPlan(repaired.text));
 for(const text of ['[[qq_search:手机]]','{"mode":"silence","reply":"","actions":[]}'])await repairLocalChatPlan({text},{reply:()=>assert.fail('valid plan/tool marker cannot be repaired')});
});
test('private short replies see the actual preceding outgoing question, never a later message or another group',async()=>{
 const {formatPrivateDialogue}=await import('./qq-private-context.mjs');const rows=[{messageId:'1',direction:'outgoing',text:'今天是不是也辛苦啦？',at:'now'},{messageId:'2',direction:'incoming',text:'是的',at:'now'},{messageId:'3',direction:'outgoing',text:'后来的不相关回复',at:'later'}];
 const text=formatPrivateDialogue({type:'private_message',senderId:'10012',messageId:'2'},rows);assert.match(text,/今天是不是也辛苦/);assert.doesNotMatch(text,/后来的不相关/);assert.equal(formatPrivateDialogue({type:'group_message'},rows),'');
});
test('direct plain replies avoid a second generation; autonomous and malformed action plans remain strict',async()=>{
 for(const text of ['辛苦啦。\n\n先歇一会儿。','[[qq_sticker:乖巧站好.webp]]','普通话题里提到JSON这个词']){
  const original={text,durationMs:2000};assert.equal(await repairLocalChatPlan(original,{allowPlainReply:true,reply:()=>assert.fail('ordinary text must not be repaired')}),original);
 }
 let calls=0;const reply=async()=>{calls++;return {text:'{"mode":"silence","reply":"","actions":[]}',durationMs:1};};
 await repairLocalChatPlan({text:'普通文字'},{allowPlainReply:false,reply,prompt:'自主决定'});
 await repairLocalChatPlan({text:'{"mode":"reply","actions":bad}'},{allowPlainReply:true,reply,prompt:'原动作协议'});
 assert.equal(calls,2);
});
