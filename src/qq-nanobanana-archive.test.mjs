import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {archiveQqImages, archiveQqImagesSafely, indexArchivedImages} from './qq-image-archive.mjs';
import {generateNanoBanana, NANO_BANANA_MODEL} from './qq-nanobanana.mjs';
import {generatedImageReply} from './qq-codex-images.mjs';
import {backfillNanoBananaArchive} from '../scripts/backfill-qq-nanobanana-archive.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'qq-nano-archive-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const sourceRoot = join(root, 'nano-banana-2'), directory = join(root, 'Downloads'), metadataDirectory = join(root, 'metadata');
  await mkdir(join(sourceRoot, id), {recursive:true});
  await mkdir(metadataDirectory);
  return {sourceRoot, directory, metadataDirectory, threadId:id};
}

test('Gemini response -> original file -> flat archive -> deliverable; repeat does not duplicate', async t => {
  const options = await fixture(t);
  const files = await generateNanoBanana({prompt:'画一只猫', outputDir:join(options.sourceRoot,id),
    readConfig:async()=>({models:{providers:{antigravity9router:{baseUrl:'http://127.0.0.1:20128/v1',apiKey:'fixture'}}}}),
    fetchImpl:async()=>Response.json({data:[{b64_json:png.toString('base64')}]})});
  const archive = await archiveQqImagesSafely({...options, files, context:{request:'画一只猫', model:NANO_BANANA_MODEL}});
  assert.equal(archive.ok,true); assert.equal(archive.copied,1);
  const record = JSON.parse(await readFile(archive.recordPath,'utf8'));
  assert.equal(record.context.model,NANO_BANANA_MODEL);
  assert.deepEqual(await readFile(join(options.directory,record.images[0].name)),png);
  assert.match(generatedImageReply(files),/\[\[qq_image:/);
  assert.equal((await archiveQqImagesSafely({...options,files})).copied,0);
  assert.equal((await readdir(options.directory)).length,1);
  assert.equal((await readFile(join(options.metadataDirectory,'生成索引.jsonl'),'utf8')).trim().split('\n').length,1);
});

test('backfill reuses user-renamed content, preserves old files, and is idempotent',async t=>{
  const options=await fixture(t);
  await mkdir(options.directory);
  await writeFile(join(options.directory,'用户取的名字.png'),png);
  await writeFile(join(options.directory,'file_mapping.json'),'keep me');
  await writeFile(join(options.sourceRoot,id,'new.png'),png);
  await writeFile(join(options.metadataDirectory,`validation_report-${id}.json`),JSON.stringify({model:NANO_BANANA_MODEL,originalRequest:'历史请求'}));
  const run=()=>backfillNanoBananaArchive({...options,sourceRoots:[options.sourceRoot]});
  const first=await run();assert.equal(first.copied,0);assert.equal(first.reused,1);assert.deepEqual(first.skipped,[]);
  const record=JSON.parse(await readFile(first.sessions[0].recordPath,'utf8'));
  assert.equal(record.images[0].name,'用户取的名字.png');
  await rename(join(options.directory,'用户取的名字.png'),join(options.directory,'又改名.png'));
  const second=await run();assert.equal(second.copied,0);assert.equal(second.reused,1);assert.deepEqual(second.skipped,[]);
  assert.deepEqual((await readdir(options.directory)).sort(),['file_mapping.json','又改名.png']);
  assert.equal(await readFile(join(options.directory,'file_mapping.json'),'utf8'),'keep me');
});

test('missing-history backfill copies verified originals once, ignoring unproven sessions',async t=>{
  const options=await fixture(t);
  await writeFile(join(options.sourceRoot,id,'new.png'),png);
  const input={...options,sourceRoots:[options.sourceRoot]};
  assert.equal((await backfillNanoBananaArchive(input)).skipped.length,1);
  await writeFile(join(options.metadataDirectory,`validation_report-${id}.json`),JSON.stringify({model:NANO_BANANA_MODEL,originalRequest:'历史请求'}));
  const first=await backfillNanoBananaArchive(input);assert.equal(first.copied,1);assert.equal(first.reused,0);
  const second=await backfillNanoBananaArchive(input);assert.equal(second.copied,0);assert.equal(second.reused,1);
  assert.deepEqual(await readFile(join(options.directory,(await readdir(options.directory))[0])),png);
});

test('archive errors keep the generated output deliverable; no outside-session or conflicting file writes',async t=>{
  const options=await fixture(t),file=join(options.sourceRoot,id,'new.png');
  await writeFile(file,png);
  await writeFile(options.directory,'blocked');
  const failed=await archiveQqImagesSafely({...options,files:[file]});
  assert.equal(failed.ok,false);assert.ok(failed.error);assert.match(generatedImageReply([file]),/\[\[qq_image:/);
  assert.deepEqual(await readFile(file),png);
  await assert.rejects(archiveQqImages({...options,files:[options.directory]}),/outside this session/);
  const other=join(options.sourceRoot,id,'escape.png');await symlink(options.directory,other);
  await assert.rejects(archiveQqImages({...options,files:[other]}),/outside this session/);
  const dest=join(options.metadataDirectory,'conflict');await mkdir(dest);
  await writeFile(join(dest,`${id}-01-new.png`),'existing');
  await assert.rejects(archiveQqImages({...options,directory:dest,files:[file]}),/verification failed/);
  assert.equal(await readFile(join(dest,`${id}-01-new.png`),'utf8'),'existing');
  assert.equal((await indexArchivedImages(dest)).size,1);
});
