import {adminFetch} from './qq-admin-fetch.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {homedir} from 'node:os';
const exec=promisify(execFile),root=process.argv[2],domain=`gui/${process.getuid()}`;
if(!root?.startsWith('/') || root==='/')throw new Error('项目路径无效');
const online=async port=>adminFetch(`http://127.0.0.1:${port}/${port===3789?'api/state':'health'}`,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false);
async function start(label){
  let state='';try{state=(await exec('/bin/launchctl',['print',`${domain}/${label}`],{timeout:8000})).stdout;}catch{
    await exec('/bin/launchctl',['bootstrap',domain,join(homedir(),'Library','LaunchAgents',`${label}.plist`)],{timeout:8000});
  }
  if(!/state = running/.test(state))await exec('/bin/launchctl',['kickstart',`${domain}/${label}`],{timeout:8000});
}
try{
  if(!(await online(3789))){
    // launchd runs the verified local service-code release, never cloud sources.
    await start('local.codexremotecontact.chat-hub');
  }
  if(!(await online(3000)))await start('local.codexremotecontact.qq-napcat');
  for(let attempt=0;attempt<25;attempt++){
    if(await online(3789)&&await online(3000))break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!(await online(3789)))throw new Error('消息后台尚未启动，请查看本机 chat-hub.err.log；QQ 登录与人设未改变');
  let loggedIn=false;
  try{loggedIn=(await(await adminFetch('http://127.0.0.1:3000/get_status',{signal:AbortSignal.timeout(3000)})).json()).data?.online===true;}catch{}
  console.log(loggedIn?'后台服务可用，QQ 已在线，AI 开关保持原状。':'后台服务已检查，但 QQ 尚未在线。请打开「扫码登录」；AI 开关保持原状。');
}catch(error){console.error(`后台恢复失败：${error.message}`);process.exitCode=1;}
