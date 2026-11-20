import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openRoleLibrary,roleScope,handleRoleLibraryRequest} from './qq-role-library.mjs';
import {parseQqRoleCommand} from './qq-role-intent.mjs';
import {parseQqImageRequest} from './qq-image-request.mjs';
import {prepareGenerationReferences} from './qq-generation.mjs';
import {buildNanoBananaPrompt} from './qq-nanobanana.mjs';

const group={type:'group_at',groupId:'20011',senderId:'10012',text:'给星铃生成这个表情包'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=','base64');
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'qq-roles-'));let store=await openRoleLibrary(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,get store(){return store;},async reopen(){store.close();store=await openRoleLibrary(dir);return store;}};}

test('real failed registration is a role command, not an image request; replacements are image edits',()=>{
  const text='[CQ:reply,id=402][CQ:at,qq=10011] 录入这个角色，这个角色名字叫星铃，以后也可以给他生图';
  assert.deepEqual(parseQqRoleCommand(text),{action:'save',name:'星铃',description:''});
  assert.equal(parseQqImageRequest(text).requested,false);
  for(const text of ['把这个表情包的角色替换成星铃','把这个表情包里的角色替换成星铃，生图','给星铃生成这个表情包'])assert.equal(parseQqImageRequest(text).requested,true,text);
  for(const text of ['你画了个锤子','为什么总把星铃画成狐宫静','不要把这个表情包的角色替换成星铃','他说“录入角色”是什么意思'])assert.equal(parseQqImageRequest(text).requested,false,text);
});

test('real role command persists copied references, is idempotent and survives restart for every sender in same group',async t=>{
  const f=await fixture(t);let preparations=0;
  const event={...group,text:'录入这个角色，这个角色名字叫星铃，以后也可以给他生图',raw:{message_id:401}};
  const result=await f.store.command(event,{prepare:async()=>{preparations++;return [png];}});
  assert.match(result.reply,/已录入.*星铃/);assert.equal(f.store.list('group:20011').length,1);
  await f.store.command(event,{prepare:async()=>[png]});assert.equal(f.store.list('group:20011').length,1);
  await f.reopen();const identity=await f.store.identity({...group,senderId:'10024'},group.text);
  assert.equal(identity.name,'星铃');assert.deepEqual(await readFile(identity.imagePaths[0]),png);
  assert.equal((await f.store.identity({...group,groupId:'20010'},group.text)).name,'星铃');
  assert.equal((await f.store.identity({...group,type:'private_message'},group.text)).name,'星铃');
  assert.doesNotMatch(JSON.stringify(f.store.list('group:20011')),/\/Users\/|\/tmp\//);
});

test('failed reference preparation never claims success; permissions, revision conflicts and alias collisions preserve cards',async t=>{
  const {store}=await fixture(t);const event={...group,text:'/角色 录入 星铃'};
  await assert.rejects(store.command(event,{prepare:async()=>{throw Error('未加载原图');}}),/未加载/);assert.equal(store.list('group:20011').length,0);
  const r=await store.save('group:20011',{name:'星铃',aliases:['星铃喵'],description:'浅蓝发，橙眼，蓝格裙。'},{actor:'10012',buffers:[png]});
  await assert.rejects(store.save(r.scope,{id:r.id,revision:r.revision,name:'星铃',description:'改错'},{actor:'10024'}),/只能更新/);
  await assert.rejects(store.save(r.scope,{name:'星铃喵',description:'冲突'},{admin:true}),/已更新|别名/);
  await assert.rejects(store.save(r.scope,{id:r.id,name:'星铃',description:'改错'},{admin:true}),/重新读取/);
  await assert.rejects(store.save(r.scope,{name:'另一位',aliases:['星铃喵'],description:'冲突'},{admin:true}),/别名/);
  assert.equal(store.get(r.scope,r.id).description,r.description);
});

test('registered identity and template are separate for GPT and Gemini, and never attach built-in fox references',async t=>{
  const {store}=await fixture(t);await store.save('group:20011',{name:'星铃',description:'浅蓝发、橙眼、黑帽、蓝格裙、蓝尾。'},{buffers:[png]});
  const role=await store.identity(group,group.text);
  const generation=await prepareGenerationReferences({event:{...group,images:[{url:'https://template.test/image'}]},text:group.text,referenceDir:'/missing-built-in',prepareImages:async()=>['/template.png'],roleIdentity:role});
  assert.equal(generation.mode,'registered-role');assert.equal(generation.character.name,'星铃');assert.deepEqual(generation.character.imagePaths,role.imagePaths);
  assert.match(generation.prompt,/星铃/);assert.doesNotMatch(generation.prompt,/浅金发|金铃铛|狐宫静 OC/);
  const banana=buildNanoBananaPrompt({request:group.text,referenceCount:1,identityCount:1,identityName:role.name,identityDescription:role.appearance});
  assert.match(banana,/星铃/);assert.doesNotMatch(banana,/浅金长发|狐宫静/);
  assert.match(store.context({...group,senderId:'10024'}),/星铃/);
});

test('shared cards work across private/group chats; role APIs still reject cross-site writes',async t=>{
  const {store}=await fixture(t),role=await store.save('private:10012',{name:'星铃',description:'私聊限定'},{buffers:[png]});
  assert.match(store.context({...group,type:'private_message',senderId:'10019'}),/星铃/);
  assert.equal(roleScope({...group,type:'private_message'}),'private:10012');
  let status;const sendJson=(_r,s)=>status=s;
  await handleRoleLibraryRequest({url:'/api/qq/roles',method:'POST',headers:{'sec-fetch-site':'cross-site'}},{},{store,isLocalRequest:()=>true,sendJson});assert.equal(status,403);
  assert.deepEqual((await store.image('group:20011',role.id,0)).bytes,png);
});
test('screenshot new-person forms with leading/trailing mentions are saved as commands, never routed to casual chat or image generation',async t=>{
 for(const text of ['[CQ:reply,id=123][CQ:at,qq=10011] 录入新人物：晴音','[CQ:reply,id=123]录入新人物：晴音[CQ:at,qq=10011]','录入新角色：晴音','录入新的角色：晴音']){
  assert.equal(parseQqRoleCommand(text).name,'晴音');assert.equal(parseQqRoleCommand(text).action,'save');assert.equal(parseQqImageRequest(text).requested,false);
 }
 for(const text of ['不要录入新人物：晴音','他说“录入新人物：晴音”是什么意思'])assert.equal(parseQqRoleCommand(text),null);
 const f=await fixture(t),event={...group,text:'[CQ:reply,id=123][CQ:at,qq=10011] 录入新人物：晴音',replyContext:{messageId:'123',images:[{file:'quoted-image'}]},raw:{message_id:409}};
 const result=await f.store.command(event,{prepare:async incoming=>{assert.equal(incoming.replyContext.images[0].file,'quoted-image');return [png];}});
 assert.match(result.reply,/已录入.*晴音.*1 张参考图/);await f.reopen();const card=f.store.byName('group:20011','晴音');assert.equal(card.images.length,1);assert.deepEqual(await readFile(join(f.dir,'images',card.images[0])),png);
 await f.store.command(event,{prepare:async()=>[png]});assert.equal(f.store.list('group:20011').length,1);
});

test('shared library preserves creator protection, edits across chats, and global deletion after reopening',async t=>{
 const f=await fixture(t),a=await f.store.save('private:10012',{name:'晴音',description:'白发蓝眼'},{actor:'10012',buffers:[png]});
 await assert.rejects(f.store.save('group:20010',{name:'晴音',description:'错误覆盖',revision:a.revision},{actor:'10019'}),/录入的角色/);
 const b=await f.store.save('group:20010',{id:a.id,name:'晴音',revision:a.revision,description:'白发蓝眼，蓝白裙'},{actor:'10012'});
 await f.reopen();assert.equal(f.store.byName('private:10019','晴音').description,b.description);assert.equal(f.store.list('group:20011').length,1);
 assert.deepEqual((await f.store.image('private:10019',b.id,0)).bytes,png);
 f.store.remove('private:10019',b.id,{actor:'10012',revision:b.revision});assert.equal(f.store.list('group:20011').length,0);
});
