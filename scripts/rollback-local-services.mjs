import {adminFetch} from './qq-admin-fetch.mjs';
// Restore code only. Shared chats, QQ login, materials and video jobs stay put.
import {readdir,readFile,realpath,symlink,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=join(homedir(),'Library','Application Support','CodexRemoteContact'),releases=join(root,'service-releases');
const selected=process.argv[process.argv.indexOf('--release')+1];
if(process.argv.includes('--list')){
  for(const name of await readdir(releases))try{const m=JSON.parse(await readFile(join(releases,name,'release-manifest.json'),'utf8'));console.log(name+' '+m.createdAt);}catch{}
}else{
  if(!process.argv.includes('--release')||!/^release-[A-Za-z0-9]+$/.test(selected||''))throw Error('用法：node scripts/rollback-local-services.mjs --release release-XXXXXX；或 --list');
  const target=join(releases,selected);if(await realpath(target)!==target)throw Error('只允许已发布的本地目录');
  const manifest=JSON.parse(await readFile(join(target,'release-manifest.json'),'utf8'));
  for(const [path,hash] of Object.entries(manifest.hashes)){const file=resolve(target,path);if(!file.startsWith(target+'/'))throw Error('发布清单路径无效');if(createHash('sha256').update(await readFile(file)).digest('hex')!==hash)throw Error('发布校验失败：'+path);}
  async function state(port,path,optional=false){const r=await adminFetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(5000)});if(optional&&r.status===404)return {};if(!r.ok)throw Error('服务状态不可确认，请先恢复控制面板连接');return r.json();}
  const bridge=await state(3000,'/health'),desktop=await state(3789,'/api/qq/chat/desktop-state'),voice=await state(3789,'/api/life/voice'),video=await state(3789,'/api/qq/videos/settings',true);
  if(bridge.active||bridge.queued||bridge.imageActive||bridge.imageQueued||desktop.groupDigest?.active||desktop.groupDigest?.queued||desktop.activeDrafts||desktop.voiceFollowups?.active||desktop.voiceFollowups?.queued||voice.busy||video.active||video.queued)throw Error('仍有任务；等待完成或由提交者取消视频后再回滚');
  const link=join(root,`service-code.rollback-${randomUUID()}.tmp`);await symlink(target,link);await rename(link,join(root,'service-code'));
  for(const service of ['chat-hub','qq-napcat'])execFileSync('launchctl',['kickstart','-k',`gui/${process.getuid()}/local.codexremotecontact.${service}`]);
  console.log('已恢复代码：'+selected+'；共享数据未改动');
}
