import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {stickerCatalog,resolveImages} from './qq-media.mjs';
test('disabled stickers disappear, queued stale markers keep text, aliases cannot bypass via direct paths; originals remain',async t=>{
  const root=await mkdtemp(join(tmpdir(),'qq-sticker-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'stickers');await mkdir(dir);await mkdir(join(dir,'imported'));
  const bytes=Buffer.from('scary-test-image'),bad=join(dir,'大眼.webp'),alias=join(dir,'imported','alias.webp'),good=join(dir,'开心.webp'),generated=join(root,'new.png');
  await Promise.all([writeFile(bad,bytes),writeFile(alias,bytes),writeFile(good,'happy'),writeFile(generated,bytes)]);
  await writeFile(join(dir,'sticker-policy.json'),JSON.stringify({disabled:[{names:['大眼.webp'],sha256:createHash('sha256').update(bytes).digest('hex')}]}));
  assert.deepEqual((await stickerCatalog(dir)).map(s=>s.name),['开心.webp']);
  assert.deepEqual(await resolveImages('文字\n[[qq_sticker:大眼.webp]]',{stickerDir:dir}),[]);
  assert.deepEqual(await resolveImages(`[[qq_image:${bad}]][[qq_image:${alias}]][[qq_image:${good}]]`,{stickerDir:dir}),[good]);
  assert.deepEqual(await resolveImages(`[[qq_image:${generated}]]`,{stickerDir:dir}),[generated]);
  assert.deepEqual(await readFile(bad),bytes);
});
