import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';

const zip=promisify(gzip),unzip=promisify(gunzip),hash=b=>createHash('sha256').update(b).digest('hex');
const builtinFiles=['appearance.md','reference-default.png','reference-summer.png'];
const maxBytes=80*1024*1024;
export function createPortableRoles({directory,readRows,commitRows,validateImage}){
  const builtinDirectory=join(directory,'builtin','hugongjing');
  async function builtinCard(){
    try{const description=await readFile(join(builtinDirectory,'appearance.md'),'utf8');return {id:'builtin-hugongjing',scope:'builtin',name:'狐宫静',aliases:[],description,readonly:true,images:[0,1].map(i=>`/api/qq/roles/builtin/image/${i}`)};}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async function exportArchive(){
    const roles=readRows();if(roles.length>5000)throw Error('角色过多，超过单次迁移包上限');
    const blobs={},builtin={};let total=0;
    const include=async(path)=>{const b=await readFile(path);total+=b.length;if(total>maxBytes)throw Error('素材超过 80 MB，请分批迁移或直接复制完整角色库文件夹');const id=hash(b);blobs[id] ||= b.toString('base64');return id;};
    const cards=[];
    for(const r of roles){const images=[];for(const name of r.images){if(!/^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/.test(name))throw Error('角色图片记录无效');images.push({name,sha256:await include(join(directory,'images',name))});}cards.push({...r,images});}
    for(const name of builtinFiles){try{builtin[name]=await include(join(builtinDirectory,name));}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(Object.keys(builtin).length&&Object.keys(builtin).length!==3)throw Error('狐宫静内置角色资料不完整，未导出');
    const packed=await zip(Buffer.from(JSON.stringify({format:'qq-companion-role-library',version:1,createdAt:new Date().toISOString(),roles:cards,builtin,blobs})),{level:1});
    if(packed.length>32*1024*1024)throw Error('迁移包超过 32 MB，请直接复制完整角色库文件夹');return packed;
  }
  async function importArchive(bytes){
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>32*1024*1024)throw Error('迁移包须小于 32 MB');
    let pack;try{pack=JSON.parse((await unzip(bytes,{maxOutputLength:120*1024*1024})).toString('utf8'));}catch{throw Error('无法读取角色库迁移包，文件损坏或超过大小上限');}
    if(pack?.format!=='qq-companion-role-library'||pack.version!==1||!Array.isArray(pack.roles)||pack.roles.length>5000||!pack.blobs||typeof pack.blobs!=='object'||!pack.builtin||typeof pack.builtin!=='object')throw Error('不是支持的角色库迁移包');
    const blobs=new Map();let total=0;
    for(const [id,encoded] of Object.entries(pack.blobs)){
      if(!/^[a-f0-9]{64}$/.test(id)||typeof encoded!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('迁移包素材格式无效');
      const b=Buffer.from(encoded,'base64');total+=b.length;if(hash(b)!==id||total>maxBytes)throw Error('迁移包校验失败或素材超过 80 MB');blobs.set(id,b);
    }
    const cards=pack.roles.map(r=>{
      if(!r||!/^[a-f0-9-]{36}$/i.test(r.id)||! /^(?:group|private):\d{5,13}$/.test(r.scope)||typeof r.name!=='string'||!r.name.trim()||Array.from(r.name).length>40||/[\r\n\[\]<>:：,，;；]/.test(r.name)||r.name.normalize('NFKC').trim().toLowerCase()==='狐宫静'||!Array.isArray(r.aliases)||r.aliases.length>12||r.aliases.some(a=>typeof a!=='string'||!a.trim()||Array.from(a).length>40||/[\r\n\[\]<>:：,，;；]/.test(a)||a.normalize('NFKC').trim().toLowerCase()==='狐宫静')||typeof r.description!=='string'||r.description.length>3000||!Array.isArray(r.images)||r.images.length>3||typeof r.creator!=='string'||r.creator.length>100||typeof r.source!=='string'||r.source.length>200||!Number.isSafeInteger(r.at)||r.at<0)throw Error('迁移包角色卡无效');
      const images=r.images.map(image=>{const b=blobs.get(image?.sha256);if(!b||b.length>5*1024*1024||image.name!==hash(b)+validateImage(b))throw Error('角色参考图校验失败');return image.name;});
      if(!r.description&&!images.length)throw Error('迁移包包含空角色');return {...r,images};
    });
    if(new Set(cards.map(r=>r.id)).size!==cards.length)throw Error('迁移包包含重复角色编号');
    const builtin=Object.entries(pack.builtin);if(builtin.length&&builtin.length!==3)throw Error('内置角色资料不完整');
    for(const [name,id] of builtin){const b=blobs.get(id);if(!builtinFiles.includes(name)||!b||(name.endsWith('.png')?validateImage(b)!=='.png':b.length>10000))throw Error('内置角色素材无效');}
    // Validate every record before writing any DB row. Filenames always derive
    // from verified hashes or a fixed builtin allowlist; archive paths are ignored.
    await mkdir(join(directory,'images'),{recursive:true,mode:0o700});
    for(const r of cards)for(const name of r.images){const b=blobs.get(name.slice(0,64)),path=join(directory,'images',name);try{await writeFile(path,b,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(hash(await readFile(path))!==hash(b))throw Error('现有参考图校验失败，未覆盖');}}
    let builtinImported=false,builtinConflict=false;
    if(builtin.length){
      const existing=await Promise.all(builtinFiles.map(name=>readFile(join(builtinDirectory,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e;})));
      if(existing.every(b=>b===null)){
        await mkdir(builtinDirectory,{recursive:true,mode:0o700});
        for(const [name,id] of builtin)await writeFile(join(builtinDirectory,name),blobs.get(id),{mode:0o600,flag:'wx'});builtinImported=true;
      }else builtinConflict=builtinFiles.some((name,i)=>!existing[i]||hash(existing[i])!==pack.builtin[name]);
    }
    const result=commitRows(cards);
    return {...result,builtinImported,builtinConflict,verifiedImages:new Set(cards.flatMap(r=>r.images)).size};
  }
  return {exportArchive,importArchive,builtinCard,builtinDirectory,
    async builtinImage(index){const name=builtinFiles[Number(index)+1];if(!name)throw Error('内置参考图不存在');return readFile(join(builtinDirectory,name));}};
}
