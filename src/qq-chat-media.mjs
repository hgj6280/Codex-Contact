import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {downloadImage} from './qq-media.mjs';
export function safeQqImageUrl(value){
  try{const u=new URL(String(value).replaceAll('&amp;','&'));
    if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&['multimedia.nt.qq.com.cn','gchat.qpic.cn','c2cpicdw.qpic.cn'].includes(u.hostname)&&(!u.port||u.port==='443'||u.port==='80')){u.protocol='https:';u.port='';return u.href;}}
  catch{}return null;
}
export function imageMime(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216)return 'image/jpeg';
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()))return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  throw new Error('QQ 返回的不是可显示图片');
}
export function imageKey(input){return createHash('sha256').update(JSON.stringify(input)).digest('hex');}
export function createChatImageCache({directory,lookup,refresh,download=downloadImage}){
  const pending=new Map(),waiters=[];let active=0;
  async function read(key){
    if(!/^[a-f0-9]{64}$/.test(key)||!lookup(key))throw new Error('图片记录不存在');
    const path=join(directory,key+'.image');
    try{const bytes=await readFile(path);return {bytes,mime:imageMime(bytes)};}catch(e){if(e.code!=='ENOENT')throw e;}
    if(pending.has(key))return pending.get(key);if(waiters.length>=64)throw new Error('图片队列繁忙，请稍后重试');
    const work=(async()=>{
      if(active>=4)await new Promise(resolve=>waiters.push(resolve));else active++;
      try{const input=lookup(key);let url=safeQqImageUrl(input.url),bytes;
        try{if(!url)throw new Error('图片链接未提供');bytes=await download(url);}
        catch(error){const next=safeQqImageUrl(await refresh(input));if(!next||next===url)throw error;bytes=await download(next);}
        if(bytes.length>20*1024*1024)throw new Error('图片超过 20 MB');const mime=imageMime(bytes);
        await mkdir(directory,{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,bytes,{mode:0o600});await rename(temp,path);return {bytes,mime};
      }finally{const next=waiters.shift();if(next)next();else active--;}
    })();pending.set(key,work);try{return await work;}finally{pending.delete(key);}
  }
  return {read};
}
