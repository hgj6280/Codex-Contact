import {readFile,copyFile,writeFile,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {patchNanoBananaRouterExecutor,assertNanoBananaRouterReferenceSupport} from '../src/qq-nanobanana-router-patch.mjs';

const root=join(homedir(),'Library','Application Support','WorkBuddy9Router','node_modules','9router','app','.next-cli-build','server');
const path=join(root,'chunks','8499.js');
const route=await readFile(join(root,'app','api','v1','images','generations','route.js'),'utf8');
const original=await readFile(path,'utf8'),patched=patchNanoBananaRouterExecutor(original);
assertNanoBananaRouterReferenceSupport(route,patched);
if(patched===original){console.log(JSON.stringify({changed:false,referenceSupport:true}));}
else{
  const backup=path+'.before-qq-nano-reference-fix-'+randomUUID();
  const stage=path+'.'+randomUUID()+'.js';
  await copyFile(path,backup,constants.COPYFILE_EXCL);
  await writeFile(stage,patched,{flag:'wx',mode:0o600});
  await promisify(execFile)(process.execPath,['--check',stage]);
  if(await readFile(path,'utf8')!==original)throw new Error('9router 文件在修复期间有变化，未覆盖');
  await rename(stage,path);
  console.log(JSON.stringify({changed:true,path,backup,referenceSupport:true,
    beforeSha256:createHash('sha256').update(original).digest('hex'),afterSha256:createHash('sha256').update(patched).digest('hex')}));
}
