import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {adminFetch} from './qq-admin-fetch.mjs';
import {rollbackStoppedChat} from '../src/qq-chat-storage.mjs';

const root=join(homedir(),'Library','Application Support','CodexRemoteContact');
const api='http://127.0.0.1:3789/api/qq/chat/storage';
try {
  const res=await adminFetch(api+'/rollback',{method:'POST',signal:AbortSignal.timeout(120000)});
  if(!res.ok || (await res.json()).mode!=='json')throw Error('在线回滚未确认，HTTP '+res.status);
} catch(error) {
  if(error.cause?.code!=='ECONNREFUSED')throw error;
  const domain='gui/'+process.getuid(), label='local.codexremotecontact.chat-hub', job=domain+'/'+label;
  const launch=(...args)=>execFileSync('/bin/launchctl',args,{stdio:'pipe'});
  let registered=true;
  try{launch('print',job);}catch(e){if(e.status!==113)throw e;registered=false;}
  if(registered)launch('bootout',job);
  try {
    rollbackStoppedChat(join(root,'data','qq-chat'));
  } finally {
    // Restore the login agent so the selected store is used immediately.
    launch('bootstrap',domain,join(homedir(),'Library','LaunchAgents',label+'.plist'));
  }
  let ready=false;
  for(let i=0;i<60&&!ready;i++){
    await new Promise(r=>setTimeout(r,1000));
    try{const res=await adminFetch(api,{signal:AbortSignal.timeout(2000)});ready=res.ok&&(await res.json()).mode==='json';}catch{}
  }
  if(!ready)throw Error('已执行离线恢复，Hub 尚未确认 JSON 模式，请查看 Hub 日志');
}
console.log('已切换为 JSON 存储，原记录及 SQLite 文件均已保留。');
