import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openRoleLibrary,handleRoleLibraryRequest} from './qq-role-library.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=','base64');
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'qq-role-transfer-'));const store=await openRoleLibrary(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,store};}
async function builtins(dir){const base=join(dir,'builtin','hugongjing');await mkdir(base,{recursive:true});await writeFile(join(base,'appearance.md'),'狐宫静：金发、红眼、一条狐尾。');for(const n of ['reference-default.png','reference-summer.png'])await writeFile(join(base,n),png);}

test('one catalog and portable package include builtin, group and private cards with verified pixels and no machine paths',async t=>{
  const a=await fixture(t),b=await fixture(t);await builtins(a.dir);
  for(const [scope,name] of [['group:20011','星铃'],['group:20011','第二位'],['private:10012','私聊角色']])await a.store.save(scope,{name,description:name+'自己的设定'},{buffers:[png]});
  const catalog=await a.store.catalog();assert.equal(catalog.roles.length,4);assert.equal(catalog.roles[0].readonly,true);
  const bytes=await a.store.exportArchive(),plain=gunzipSync(bytes).toString();assert.doesNotMatch(plain,/\/Users\/|\/tmp\/|apiKey|accessToken/);
  const imported=await b.store.importArchive(bytes);assert.equal(imported.imported,3);assert.equal(imported.builtinImported,true);assert.deepEqual(imported.conflicts,[]);
  assert.equal((await b.store.catalog()).roles.length,4);assert.equal(b.store.list('group:20011').length,3);assert.equal(b.store.list('private:10012').length,3);
  const identity=await b.store.identity({type:'group_message',groupId:'20011'},'给星铃生图');assert.deepEqual(await readFile(identity.imagePaths[0]),png);
  assert.equal((await b.store.identity({type:'group_message',groupId:'20010'},'给星铃生图')).name,'星铃');
  assert.deepEqual(await b.store.builtinImage(0),png);
  const repeat=await b.store.importArchive(bytes);assert.equal(repeat.imported,0);assert.equal(repeat.skipped,3);assert.equal(repeat.builtinConflict,false);
});

test('import reports changed cards and conflicting aliases without overwriting local data',async t=>{
  const a=await fixture(t),b=await fixture(t);
  await a.store.save('group:20011',{name:'星铃',description:'原版'},{buffers:[png]});const bytes=await a.store.exportArchive();await b.store.importArchive(bytes);
  const r=b.store.byName('group:20011','星铃');await b.store.save(r.scope,{...r,description:'本机已更正'},{admin:true});
  const result=await b.store.importArchive(bytes);assert.equal(result.imported,0);assert.equal(result.conflicts.length,1);assert.equal(b.store.byName(r.scope,r.name).description,'本机已更正');
});

test('corrupt hashes and path traversal archives cannot write a role or builtin file',async t=>{
  const a=await fixture(t),b=await fixture(t);await builtins(a.dir);await a.store.save('private:10012',{name:'角色',description:'设定'},{buffers:[png]});
  const pack=JSON.parse(gunzipSync(await a.store.exportArchive()));
  const variants=[structuredClone(pack),structuredClone(pack),structuredClone(pack)];
  variants[0].roles[0].images[0].name='../outside.png';variants[1].blobs[variants[1].roles[0].images[0].sha256]=Buffer.from('bad').toString('base64');variants[2].builtin['../../outside.md']=Object.values(pack.builtin)[0];
  for(const variant of variants)await assert.rejects(b.store.importArchive(gzipSync(JSON.stringify(variant))));
  assert.equal((await b.store.catalog()).roles.length,0);
  await assert.rejects(b.store.importArchive(Buffer.from('not gzip')),/损坏/);
});

test('whole-library routes remain local admin only even without a conversation selected',async t=>{
  const {store}=await fixture(t);let status,body;const sendJson=(_res,s,b)=>{status=s;body=b;};
  await handleRoleLibraryRequest({url:'/api/qq/roles/library',method:'GET',headers:{}},{},{store,isLocalRequest:()=>true,sendJson});assert.equal(status,200);assert.deepEqual(body.roles,[]);
  for(const path of ['/library','/export','/import']){await handleRoleLibraryRequest({url:'/api/qq/roles'+path,method:'POST',headers:{'sec-fetch-site':'cross-site'}},{},{store,isLocalRequest:()=>true,sendJson});assert.equal(status,403);}
});
