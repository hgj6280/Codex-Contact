import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';

// Native mode must never silently restart the old Docker VM on a login error.
export async function ensureQqBackend({exec, read=readFile, home=homedir(), uid=process.getuid()}={}) {
  let config;
  try { config=JSON.parse(await read(new URL('./state/backend.json',import.meta.url),'utf8')); }
  catch(error) { if(error.code!=='ENOENT')throw error; config={kind:'docker'}; }
  if(config.kind==='native-pending')throw new Error('原生 QQ 迁移等待本机签名授权；虚拟机保持关闭，原版 QQ 与旧登录数据已保留');
  if(config.kind==='native') {
    const domain=`gui/${uid}`,label='local.codexremotecontact.qq-native';
    let status='';
    try { status=(await exec('/bin/launchctl',['print',`${domain}/${label}`],{timeout:8000})).stdout; }
    catch { await exec('/bin/launchctl',['bootstrap',domain,join(home,'Library','LaunchAgents',`${label}.plist`)],{timeout:8000}); }
    if(!/state = running/.test(status))await exec('/bin/launchctl',['kickstart',`${domain}/${label}`],{timeout:8000});
    return 'native';
  }
  if(!['docker','snowluma'].includes(config.kind))throw new Error('Unknown QQ backend; refusing to start Docker');
  if(config.kind==='snowluma'&&config.profile!=='qq-contact')throw new Error('SnowLuma requires the isolated qq-contact profile');
  if(config.profile&&config.profile!=='qq-contact')throw new Error('Unknown QQ Docker profile');
  const profile=config.profile?['--profile',config.profile]:[];
  try { await exec('/opt/homebrew/bin/colima',[...profile,'status']); }
  catch { await exec('/opt/homebrew/bin/colima',[...profile,'start',...(config.profile?[
    '--cpu','2','--memory','2','--disk','8','--root-disk','8','--vm-type','vz','--arch','aarch64','--runtime','docker','--activate=false',
    '--mount',join(home,'Library','Application Support','CodexRemoteContact')+':w','--mount-type','virtiofs','--ssh-agent=false'
  ]:[])],{timeout:180000}); }
  const dockerArgs=['--context',config.profile?'colima-'+config.profile:'colima'];
  if(config.kind==='snowluma'){
    // Only operate an already-installed official runtime. Never recreate it or
    // let login recovery start a second QQ engine for the same bot account.
    await exec('/opt/homebrew/bin/docker',[...dockerArgs,'inspect','codex-contact-snowluma'],{timeout:8000});
    await exec('/opt/homebrew/bin/docker',[...dockerArgs,'stop','codex-contact-napcat'],{timeout:60000});
  }
  await exec('/opt/homebrew/bin/docker',[...dockerArgs,'start',config.kind==='snowluma'?'codex-contact-snowluma':'codex-contact-napcat'],{timeout:60000});
  return config.kind;
}

export async function recoverQqLogin({exec,read=readFile,recovery,...options}){
  const text=await read(new URL('./state/backend.json',import.meta.url),'utf8');
  const config=JSON.parse(text);
  if(['docker','snowluma'].includes(config.kind))await ensureQqBackend({exec,read:async()=>text,...options});
  // Native restart quotas stay entirely inside the existing recovery manager.
  return recovery.tick({manual:true});
}

export function qqBackendInfo(config={}){
  return config.kind==='snowluma'
    ? {engine:'snowluma',loginUrl:'http://127.0.0.1:6081/vnc.html?autoconnect=1&resize=scale',managerUrl:'http://127.0.0.1:5099/'}
    : {engine:config.kind==='native'?'native':'napcat',loginUrl:'http://127.0.0.1:6099/webui/web_login',managerUrl:'http://127.0.0.1:6099/webui/'};
}
