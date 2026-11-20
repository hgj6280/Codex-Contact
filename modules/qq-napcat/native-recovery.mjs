import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export const NATIVE_RECOVERY_POLICY=Object.freeze({intervalMs:30000,offlineGraceMs:90000,startupGraceMs:60000,restartDelayMs:300000,maxRestartsPerHour:2});
const labels={checking:'正在核对QQ登录状态',online:'QQ已在线',offline:'QQ已离线，等待短暂重连',recovering:'正在恢复机器人专用QQ登录',awaiting_scan:'QQ需要手机扫码确认，不再自动重启',backoff:'自动恢复已暂缓，避免反复重启',waiting_io:'等待当前QQ请求结束后恢复',disabled:'当前不是原生QQ，自动恢复未启用',blocked:'自动恢复状态异常，已暂停重启'};

// No password/token access, shell text, extra process, or model calls. Only the
// fixed native launchd agent can be restarted by the injected host operation.
export async function openNativeRecovery({path,probe,restart,isNative,qrModifiedAt,isIdle=()=>true,now=Date.now}){
  let state={phase:'checking',reason:'starting',offlineSince:null,lastOnlineAt:0,lastRestartAt:0,attempts:[],events:[]},corrupt=false;
  try{const saved=JSON.parse(await readFile(path,'utf8'));if(!Array.isArray(saved.attempts)||!saved.attempts.every(Number.isFinite)||!Array.isArray(saved.events))throw Error('Invalid state');state={...state,...saved};}catch(e){if(e.code!=='ENOENT')corrupt=true;}
  const openedAt=now();let observation=null,inflight=null,blocked=corrupt;
  async function save(){
    const temp=path+'.'+randomUUID()+'.tmp';await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(temp,path);
  }
  async function phase(value,reason){if(state.phase===value&&state.reason===reason)return;state.phase=value;state.reason=reason;state.events=[...state.events,{at:now(),phase:value,reason}].slice(-20);await save();}
  function observe(online){if(typeof online!=='boolean')return;observation={online,at:now()};if(online){state.lastOnlineAt=now();state.offlineSince=null;}else if(state.offlineSince===null)state.offlineSince=now();}
  function snapshot(){return {online:observation&&now()-observation.at<=60000?observation.online:null,phase:blocked?'blocked':state.phase,message:labels[blocked?'blocked':state.phase]||labels.checking,reason:state.reason,lastOnlineAt:state.lastOnlineAt,lastRestartAt:state.lastRestartAt,offlineSince:state.offlineSince,restartsInLastHour:state.attempts.filter(t=>now()-t<3600000).length,events:state.events.slice(-8),policy:NATIVE_RECOVERY_POLICY};}
  async function run({manual=false}={}){
    if(blocked)return snapshot();
    try{
      const native=await isNative();
      let online=null;
      try{online=await probe();}catch{/* Transport unknown is not proof of logout. */}
      if(typeof online==='boolean')observe(online);
      if(online===true){await phase('online','confirmed-online');return snapshot();}
      // All backends need a real status probe. Only the native backend may
      // restart the managed Mac QQ agent; Linux handles its own login recovery.
      if(!native){await phase('disabled','not-native');return snapshot();}
      const qrAt=await qrModifiedAt().catch(()=>0);
      const newQr=qrAt>Math.max(state.lastOnlineAt,state.lastRestartAt-1000)&&(state.lastRestartAt>0||online===null&&now()-qrAt<180000);
      if(newQr&&qrAt>0){await phase('awaiting_scan','qr-confirmation-required');return snapshot();}
      if(state.phase==='awaiting_scan')return snapshot();
      if(online!==false){await phase('checking','status-unconfirmed');return snapshot();}
      if(!manual&&(now()-openedAt<NATIVE_RECOVERY_POLICY.startupGraceMs||now()-state.offlineSince<NATIVE_RECOVERY_POLICY.offlineGraceMs)){await phase('offline','waiting-for-reconnect');return snapshot();}
      state.attempts=state.attempts.filter(t=>now()-t<3600000);
      if(state.attempts.length>=NATIVE_RECOVERY_POLICY.maxRestartsPerHour||state.lastRestartAt&&now()-state.lastRestartAt<NATIVE_RECOVERY_POLICY.restartDelayMs){await phase('backoff','restart-limit');return snapshot();}
      if(!isIdle()){await phase('waiting_io','pending-native-requests');return snapshot();}
      // Persist the reservation BEFORE restarting. Restarting the bridge cannot
      // erase the attempt budget, even if launchctl times out or fails.
      state.lastRestartAt=now();state.attempts.push(now());await phase('recovering','native-agent-restart');await save();
      try{await restart();}catch{await phase('backoff','native-restart-failed');}
      return snapshot();
    }catch{blocked=true;state.phase='blocked';state.reason='recovery-state-unavailable';return snapshot();}
  }
  function tick(options){if(inflight)return inflight;inflight=run(options).finally(()=>{inflight=null;});return inflight;}
  return {observe,snapshot,tick};
}
