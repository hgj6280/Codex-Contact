import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createChatImageCache,safeQqImageUrl,imageKey,imageMime} from './qq-chat-media.mjs';
const gif=Buffer.from('GIF89a01234567');
test('chat media rejects foreign/private URL forms and retains animation bytes',()=>{
  for(const u of ['http://127.0.0.1/x','https://foreign.test/x','https://gchat.qpic.cn:3789/x','file:///etc/passwd','https://a:b@gchat.qpic.cn/x'])assert.equal(safeQqImageUrl(u),null);
  assert.equal(safeQqImageUrl('http://gchat.qpic.cn/x?a=1&amp;b=2'),'https://gchat.qpic.cn/x?a=1&b=2');assert.equal(imageMime(gif),'image/gif');assert.throws(()=>imageMime(Buffer.from('<html>')));
});
test('real cache pipeline refreshes an expired URL, deduplicates concurrent loads and survives restart',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'qq-chat-media-'));t.after(()=>rm(directory,{recursive:true,force:true}));const input={url:'https://gchat.qpic.cn/expired',file:'QQFILE'},key=imageKey(input);let downloads=0,refreshes=0;
  const options={directory,lookup:id=>id===key?input:null,download:async url=>{downloads++;if(url.endsWith('/expired'))throw new Error('QQ image download failed');return gif;},refresh:async d=>{assert.equal(d.file,'QQFILE');refreshes++;return 'https://gchat.qpic.cn/fresh';}};
  const cache=createChatImageCache(options);const results=await Promise.all([cache.read(key),cache.read(key)]);assert.equal(downloads,2);assert.equal(refreshes,1);assert.deepEqual(results[0].bytes,gif);
  assert.equal((await createChatImageCache({...options,download:()=>{throw new Error('offline');}}).read(key)).mime,'image/gif');await assert.rejects(cache.read('../secret'));
});
