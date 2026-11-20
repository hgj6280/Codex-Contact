import {normalizeQqImageUrl} from './qq-media.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, stat, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractImages, stripImageMarkers, resolveImages, prepareImages, stickerCatalog, imageSegment,downloadGenerationReference} from './qq-media.mjs';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');

test('generation CDN recovery tolerates an unchanged refreshed URL and redacts failed URLs',async()=>{
  let calls=0,refreshes=0;const attempts=[];
  const bytes=await downloadGenerationReference({file:'f',url:'https://gchat.qpic.cn/test?rkey=private-secret'},{
    download:async()=>{if(++calls<3)throw new Error('QQ image download timed out https://gchat.qpic.cn/test?rkey=private-secret');return tinyPng},
    fetchOneBotImage:async()=>{refreshes++;return {url:'https://gchat.qpic.cn/test?rkey=private-secret'}},
    onAttempt:a=>attempts.push(a),wait:async()=>{}});
  assert.deepEqual(bytes,tinyPng);assert.equal(calls,3);assert.equal(refreshes,2);
  assert.doesNotMatch(JSON.stringify(attempts),/private-secret/);
});

test('generation recovery never retries unsafe destinations, unsupported content or authentication',async()=>{
  for(const message of ['Private image destination blocked','QQ image URL host is not permitted','Unsupported QQ image content','QQ image download failed (HTTP 401)']){
    let calls=0;await assert.rejects(downloadGenerationReference({url:'https://gchat.qpic.cn/test'},{download:async()=>{calls++;throw new Error(message)},wait:()=>assert.fail()}));assert.equal(calls,1);
  }
});

test('OneBot images are extracted without text segments', () => {
  assert.deepEqual(extractImages({message:[{type:'text',data:{text:'hi'}},{type:'image',data:{file:'id',url:'https://gchat.qpic.cn/test'}}]}), [{file:'id',url:'https://gchat.qpic.cn/test'}]);
});
test('markers never leak as plain text', () => {
  assert.equal(stripImageMarkers('你好 [[qq_sticker:开心.png]] [[qq_image:/a.png]]'),'你好');
});
test('full sticker catalog is not truncated at 100 entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qq-catalog-test-'));
  try {
    await Promise.all(Array.from({length: 672}, (_, i) => writeFile(join(dir, `sticker-${String(i).padStart(3,'0')}.webp`), 'fixture')));
    const items = await stickerCatalog(dir);
    assert.equal(items.length, 672);
    assert.deepEqual(await resolveImages('[[qq_sticker:sticker-671.webp]]', {stickerDir:dir}), [join(dir,'sticker-671.webp')]);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});
test('missing and traversal stickers fail closed', async () => {
  assert.deepEqual(await stickerCatalog('/nonexistent-qq-sticker-library'),[]);
  await assert.rejects(resolveImages('[[qq_sticker:../secret.png]]',{stickerDir:'/nonexistent-qq-sticker-library'}));
  await assert.rejects(resolveImages('[[qq_image:a]][[qq_image:b]][[qq_image:c]][[qq_image:d]]'));
});
test('unsafe download destinations are rejected', async () => {
  const errors=[];
  const paths=await prepareImages([{url:'http://127.0.0.1/secret'},{url:'https://example.com/test'}],{
    outputDir:new URL('../tmp/qq-images',import.meta.url).pathname,onError:e=>errors.push(e)
  });
  assert.deepEqual(paths,[]);assert.equal(errors.length,2);
});
test('quoted images over 5 MiB are reduced to a readable model attachment', async () => {
  const dir=await mkdtemp(join(tmpdir(),'qq-quoted-large-test-'));
  try {
    const errors=[];
    const image=Buffer.concat([tinyPng,Buffer.alloc(6*1024*1024)]);
    const paths=await prepareImages([{file:'quoted-image.png',url:'https://gchat.qpic.cn/quoted'}],{
      outputDir:dir,download:async()=>image,onError:e=>errors.push(e)
    });
    assert.deepEqual(errors,[]);
    assert.equal(paths.length,1);
    assert.match(paths[0],/-model\.jpg$/);
    assert.ok((await stat(paths[0])).size <= 5*1024*1024);
    assert.equal((await imageSegment(paths[0],[dir])).type,'image');
    assert.deepEqual(await readdir(dir),[paths[0].split('/').at(-1)]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('small quoted images keep their original format', async () => {
  const dir=await mkdtemp(join(tmpdir(),'qq-quoted-small-test-'));
  try {
    const paths=await prepareImages([{url:'https://gchat.qpic.cn/quoted'}],{
      outputDir:dir,download:async()=>tinyPng
    });
    assert.equal(paths.length,1);
    assert.match(paths[0],/\.png$/);
    assert.equal((await stat(paths[0])).size,tinyPng.length);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('animated GIF is flattened into a PNG attachment for CLI and OCR', async () => {
  const dir=await mkdtemp(join(tmpdir(),'qq-animated-test-'));
  try {
    const first=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7','base64');
    const gif=Buffer.concat([first.subarray(0,-1),first.subarray(19,-1),Buffer.from([59])]);
    const errors=[];
    const paths=await prepareImages([{url:'https://gchat.qpic.cn/animated'}],{
      outputDir:dir,download:async()=>gif,onError:e=>errors.push(e)
    });
    assert.deepEqual(errors,[]);assert.equal(paths.length,1);
    assert.match(paths[0],/-frame\.png$/);
    assert.equal((await imageSegment(paths[0],[dir])).type,'image');
    assert.deepEqual(await readdir(dir),[paths[0].split('/').at(-1)]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('an expired quoted CDN URL is refreshed through OneBot once', async () => {
  const dir=await mkdtemp(join(tmpdir(),'qq-quoted-refresh-test-'));
  try {
    const urls=[];
    const paths=await prepareImages([{file:'quoted-image',url:'https://gchat.qpic.cn/old'}],{
      outputDir:dir,
      fetchOneBotImage:async file=>{assert.equal(file,'quoted-image');return {url:'https://gchat.qpic.cn/new'};},
      download:async url=>{urls.push(url);if(url.endsWith('/old')) throw new Error('QQ image download failed');return tinyPng;}
    });
    assert.equal(paths.length,1);
    assert.deepEqual(urls,['https://gchat.qpic.cn/old','https://gchat.qpic.cn/new']);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('QQ historical HTTP CDN links upgrade to HTTPS without admitting arbitrary hosts, ports or credentials',()=>{
 assert.equal(normalizeQqImageUrl('http://gchat.qpic.cn/gchatpic_new/1/2/0?term=2').href,'https://gchat.qpic.cn/gchatpic_new/1/2/0?term=2');
 for(const url of ['http://127.0.0.1/a','http://gchat.qpic.cn.evil.test/a','http://gchat.qpic.cn:3000/a','http://u:p@gchat.qpic.cn/a','file:///tmp/a'])assert.throws(()=>normalizeQqImageUrl(url),/not permitted/);
});
