import { readdir, mkdir, stat, copyFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run=promisify(execFile);
const root=process.argv[2];
if(!root)throw Error('Extracted source directory required');
const out=fileURLToPath(new URL('../../data/qq-stickers/imported/',import.meta.url));
await mkdir(out,{recursive:true});
const records=[];
for(const [folder,prefix] of [['狐宫静OC表情包','oc'],['qq收藏的全部表情','qq']]) {
 const files=(await readdir(join(root,folder))).filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 for(const [i,file] of files.entries()) {
  const src=join(root,folder,file);const info=await stat(src);if(!info.isFile())continue;
  const id=`${prefix}-${String(i+1).padStart(3,'0')}`;let dest;
  try {
   if(extname(file).toLowerCase()==='.gif') {
    dest=join(out,id+'.gif');
    if(info.size<=5*1024*1024)await copyFile(src,dest);
    else await run('/opt/homebrew/bin/magick',[src,'-coalesce','-resize','384x384>','-layers','Optimize',dest],{timeout:45000});
   } else {
    dest=join(out,id+'.webp');
    await run('/opt/homebrew/bin/magick',[src+'[0]','-auto-orient','-resize','768x768>','-strip','-quality','82',dest],{timeout:20000});
   }
   const size=(await stat(dest)).size;
   records.push({id,source:file,path:dest,bytes:size,originalBytes:info.size,usable:size<=5*1024*1024});
  }catch {records.push({id,source:file,error:'conversion failed'});}
  if((i+1)%50===0)console.log(prefix,i+1,'processed');
 }
}
await writeFile(join(out,'manifest.json'),JSON.stringify(records,null,2));
console.log(JSON.stringify({count:records.length,usable:records.filter(r=>r.usable).length,bytes:records.reduce((n,r)=>n+(r.bytes||0),0)}));
