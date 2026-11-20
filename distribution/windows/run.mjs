import {readFile,mkdir,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
const root=fileURLToPath(new URL('.',import.meta.url));
const cli=JSON.parse(await readFile(join(root,'launch.json'),'utf8')).cli;
const lockPath=join(root,'runtime/run.lock');
await mkdir(join(root,'runtime/logs'),{recursive:true});
let lock;
try{lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));}catch{throw Error('Service already started or stale runtime/run.lock. Verify no service is running before removing the lock.');}
const env={...process.env,HOME:homedir(),CODEX_CLI_PATH:cli,CODEX_WINDOWS_LAUNCHER:'1',CODEX_REMOTE_CONTACT_LOCAL_RUNTIME_DIR:join(root,'runtime/local'),CODEX_REMOTE_CONTACT_QQ_IMAGE_ARCHIVE_DIR:join(root,'runtime/images'),CODEX_REMOTE_CONTACT_QQ_PROACTIVE:'0',CODEX_REMOTE_CONTACT_QQ_WEB_LOOKUP:'0'};
const children=[];
for(const [name,script] of [['hub','app/src/server.js'],['bridge','app/modules/qq-napcat/bridge.mjs']]){
  const log=await open(join(root,`runtime/logs/${name}.log`),'a');
  const child=spawn(process.execPath,[join(root,script)],{cwd:join(root,'app'),env,stdio:['ignore',log.fd,log.fd],windowsHide:true});
  children.push(child);child.on('exit',()=>{if(!stopping)shutdown(1);});
}
let stopping=false;
async function shutdown(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();await lock.close();const {unlink}=await import('node:fs/promises');await unlink(lockPath).catch(()=>{});process.exit(code);}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());
console.log('QQ hub running: http://127.0.0.1:3789 . Close this window to stop.');
await new Promise(r=>setTimeout(r,2000));
if(process.platform==='win32')spawn('explorer.exe',['http://127.0.0.1:3789/desktop.html'],{windowsHide:true});
