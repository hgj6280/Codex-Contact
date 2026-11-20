import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
export async function recoverStaleHost(exec){
 try{await exec('/opt/homebrew/bin/colima',['--profile','qq-contact','status'],{timeout:15000});}
 catch(e){const text=[e.message,e.stdout,e.stderr].join('\n');
  if(/vz driver is running but host agent is not|host agent is running but driver is not/.test(text)){
   console.log('Recovering stale qq-contact VM management state');
   await exec('/opt/homebrew/bin/colima',['--profile','qq-contact','stop','--force'],{timeout:60000});
  }
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const root=join(homedir(),'Library/Application Support/CodexRemoteContact/service-code');
 const cfg=JSON.parse(await readFile(join(root,'modules/qq-napcat/state/backend.json'),'utf8'));
 if(['snowluma','docker'].includes(cfg.kind)&&cfg.profile==='qq-contact')await recoverStaleHost(promisify(execFile));
 await import(pathToFileURL(join(root,'modules/qq-napcat/bootstrap.mjs')).href);
 if(['snowluma','docker'].includes(cfg.kind)&&cfg.profile==='qq-contact'){
  const {ensureQqBackend}=await import(pathToFileURL(join(root,'modules/qq-napcat/backend.mjs')).href);
  const exec=promisify(execFile);let recovering=false;
  setInterval(async()=>{
   if(recovering)return;
   try{await exec('/opt/homebrew/bin/colima',['--profile','qq-contact','status'],{timeout:15000});}
   catch{recovering=true;try{await recoverStaleHost(exec);await ensureQqBackend({exec});console.log('QQ backend dependency restored');}catch{console.warn('QQ backend dependency recovery failed; retrying on next check');}finally{recovering=false;}}
  },60000).unref();
 }

}
