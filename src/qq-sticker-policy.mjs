import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative,isAbsolute,basename} from 'node:path';

async function policy(dir){
  if(!dir)return {disabled:[]};
  try{
    const data=JSON.parse(await readFile(join(dir,'sticker-policy.json'),'utf8'));
    if(!Array.isArray(data.disabled))throw Error('Invalid sticker policy');
    return data;
  }catch(e){if(e.code==='ENOENT')return {disabled:[]};throw e;}
}
export async function isStickerDisabled(name,dir){
  return (await policy(dir)).disabled.some(x=>x.names?.includes(name));
}
export async function filterStickerCatalog(items,dir){
  const {disabled}=await policy(dir),names=new Set(disabled.flatMap(x=>x.names||[]));
  return items.filter(x=>!names.has(x.name));
}
export async function filterStickerMedia(paths,dir){
  const {disabled}=await policy(dir);
  if(!disabled.length)return paths;
  const root=await realpath(dir),names=new Set(disabled.flatMap(x=>x.names||[]));
  const hashes=new Set(disabled.map(x=>x.sha256).filter(Boolean)),allowed=[];
  for(const path of paths){
    const resolved=await realpath(path),rel=relative(root,resolved);
    if(rel==='..'||rel.startsWith('../')||isAbsolute(rel)){allowed.push(path);continue;}
    if(names.has(basename(resolved)))continue;
    if(hashes.has(createHash('sha256').update(await readFile(resolved)).digest('hex')))continue;
    allowed.push(path);
  }
  return allowed;
}
