import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCharacterCache } from './qq-character-cache.mjs';
test('OC cache preserves exact assets and remains usable after cloud source disappears',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'qq-oc-cache-test-'));
  try{
    const source=join(dir,'cloud'),local=join(dir,'local');await mkdir(source);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
    await writeFile(join(source,'appearance.md'),'狐宫静 长金发 红眼 单尾');
    for(const name of ['reference-default.png','reference-summer.png']) await writeFile(join(source,name),png);
    await ensureCharacterCache(source,local);
    for(const name of ['appearance.md','reference-default.png','reference-summer.png']) assert.deepEqual(await readFile(join(source,name)),await readFile(join(local,name)));
    await rm(source,{recursive:true});
    await ensureCharacterCache(source,local);
    const manifest=JSON.parse(await readFile(join(local,'manifest.json'),'utf8'));
    assert.equal(Object.keys(manifest.hashes).length,3);
  }finally{await rm(dir,{recursive:true,force:true});}
});
