import {readFile,open,mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';

export async function desktopKey(path){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{const file=await open(path,'wx',0o600);try{await file.writeFile(randomBytes(32).toString('hex'));}finally{await file.close();}}catch(e){if(e.code!=='EEXIST')throw e;}
  const key=(await readFile(path,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(key))throw new Error('桌面服务凭证无效');return key;
}
export function matchesDesktopKey(value,key){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&value.length===key.length&&timingSafeEqual(Buffer.from(value),Buffer.from(key));}
export const desktopReadActions=new Set(['get_login_info','get_status','get_friend_list','get_group_list','get_group_info','get_group_member_info','get_group_member_list','get_stranger_info']);
export const desktopWriteActions=new Set(['send_group_msg','send_private_msg','set_friend_add_request','set_group_add_request','set_group_name','set_group_card','set_group_ban','set_group_whole_ban','set_group_kick','set_group_admin']);
const validId=value=>/^\d{5,13}$/.test(String(value));
export function normalizeDirectory(friends,groups,account){
  return {account:{id:String(account.user_id),name:String(account.nickname||'QQ')},
    friends:friends.filter(f=>validId(f.user_id)).map(f=>({id:`private:${f.user_id}`,type:'private',name:String(f.remark||f.nickname||f.user_id),nickname:String(f.nickname||''),userId:String(f.user_id)})),
    groups:groups.filter(g=>validId(g.group_id)).map(g=>({id:String(g.group_id),type:'group',name:String(g.group_name||g.group_id),memberCount:Number(g.member_count)||0})),syncedAt:new Date().toISOString()};
}
export async function openDesktopDirectory({directory,call}){
  await mkdir(directory,{recursive:true,mode:0o700});let data={friends:[],groups:[],account:null,syncedAt:null},at=0,pending=null,error=null;
  const path=join(directory,'contacts.json');try{data=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const snapshot=()=>({...structuredClone(data),stale:!!error||!at,error});
  const refresh=async(force=false)=>{
    if(!force&&at&&Date.now()-at<60000)return snapshot();if(pending)return pending;
    pending=(async()=>{try{
      const [friends,groups,account]=await Promise.all([call('get_friend_list'),call('get_group_list'),call('get_login_info')]);
      if(!Array.isArray(friends)||!Array.isArray(groups)||!validId(account?.user_id))throw new Error('通讯录数据不完整');
      const next=normalizeDirectory(friends,groups,account);const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,path);data=next;at=Date.now();error=null;
    }catch(e){error=e.message;at=Date.now();}finally{pending=null;}return snapshot();})();return pending;
  };
  return {refresh,snapshot,
    groups:()=>data.groups.map(g=>g.id),users:()=>data.friends.map(f=>f.userId),
    async assertFresh(id){const s=await refresh(true);if(s.stale)throw new Error('QQ 通讯录未能同步，暂不执行发送或管理操作');if(![...s.groups,...s.friends].some(c=>c.id===id))throw new Error('目标不是当前 QQ 好友或已加入的群聊');}
  };
}
export async function openDesktopManagement({directory,contacts,call,now=Date.now}){
  const path=join(directory,'management.json');let data={requests:{},actions:{}};let tail=Promise.resolve();
  try{data=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const entry of Object.values(data.actions))if(entry.status==='running')entry.status='unknown';
  const save=()=>{const snapshot=JSON.stringify(data);tail=tail.then(async()=>{const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,snapshot,{mode:0o600});await rename(temp,path);});return tail;};
  const validateGroup=async id=>{if(!validId(id))throw new Error('群号无效');await contacts.assertFresh(String(id));};
  const roleRank=role=>({member:0,admin:1,owner:2})[role]??-1;
  async function group(id){await validateGroup(id);const selfId=contacts.snapshot().account.id;
    const [info,me,members]=await Promise.all([call('get_group_info',{group_id:Number(id),no_cache:true}),call('get_group_member_info',{group_id:Number(id),user_id:Number(selfId),no_cache:true}),call('get_group_member_list',{group_id:Number(id),no_cache:true})]);
    if(!Array.isArray(members)||roleRank(me.role)<0||String(me.user_id)!==selfId)throw new Error('无法确认群权限');
    return {id:String(id),name:info.group_name,role:me.role,selfId,wholeBan:Number.isFinite(Number(info.group_all_shut))&&Number(info.group_all_shut)!==0,members:members.map(m=>({id:String(m.user_id),name:String(m.card||m.nickname||m.user_id),card:String(m.card||''),role:m.role,banUntil:Number(m.shut_up_timestamp)||0}))};
  }
  async function plan(input){
    if(input.kind==='request'){
      const req=data.requests[input.target];if(!req||req.status!=='pending')throw new Error('申请不存在或已经处理');
      if(typeof input.approve!=='boolean')throw new Error('请选择同意或拒绝');
      if(req.type==='group'&&req.subType!=='invite'){await validateGroup(req.groupId);const selfId=contacts.snapshot().account.id;const me=await call('get_group_member_info',{group_id:Number(req.groupId),user_id:Number(selfId),no_cache:true});if(roleRank(me.role)<1||String(me.user_id)!==selfId)throw new Error('没有群管理员权限');}
      const remark=String(input.value||'');if(remark.length>50)throw new Error('备注最多 50 字');
      return {action:req.type==='friend'?'set_friend_add_request':'set_group_add_request',params:{flag:req.flag,approve:input.approve,...(req.type==='group'?{sub_type:req.subType,reason:remark}:{remark})},request:req};
    }
    await validateGroup(input.groupId);const groupId=String(input.groupId),selfId=contacts.snapshot().account.id;
    const me=await call('get_group_member_info',{group_id:Number(groupId),user_id:Number(selfId),no_cache:true});const mine=roleRank(me.role);
    if(mine<0||String(me.user_id)!==selfId)throw new Error('无法确认本人的群权限');
    const params={group_id:Number(groupId)};let target;
    if(['card','ban','kick','admin'].includes(input.kind)){
      if(!validId(input.userId))throw new Error('成员 QQ 号无效');params.user_id=Number(input.userId);
      target=await call('get_group_member_info',{...params,no_cache:true});if(String(target.user_id)!==String(input.userId)||roleRank(target.role)<0)throw new Error('成员或权限无法确认');
    }
    if(input.kind==='card'){
      if(String(input.userId)!==selfId&&(mine<1||roleRank(target.role)>=mine))throw new Error('只能修改自己或权限低于自己的成员名片');
      if(String(input.value||'').length>60)throw new Error('名片最多 60 字');return {action:'set_group_card',params:{...params,card:String(input.value||'')}};
    }
    if(mine<1)throw new Error('只有群管理员或群主可执行此操作');
    if(input.kind==='name'){const name=String(input.value||'').trim();if(!name||name.length>60)throw new Error('群名称需为 1–60 字');return {action:'set_group_name',params:{...params,group_name:name}};}
    if(input.kind==='wholeBan'){if(typeof input.enable!=='boolean')throw new Error('禁言开关无效');return {action:'set_group_whole_ban',params:{...params,enable:input.enable}};}
    if(target&&(String(input.userId)===selfId||roleRank(target.role)>=mine))throw new Error('不能操作本人或同级/更高权限成员');
    if(input.kind==='admin'){if(mine!==2)throw new Error('只有群主可以任免管理员');if(typeof input.enable!=='boolean')throw new Error('管理员开关无效');return {action:'set_group_admin',params:{...params,enable:input.enable}};}
    if(input.kind==='ban'){const duration=Number(input.duration);if(!Number.isSafeInteger(duration)||duration<0||duration>2592000)throw new Error('禁言时长需在 0–30 天内');return {action:'set_group_ban',params:{...params,duration}};}
    if(input.kind==='kick')return {action:'set_group_kick',params:{...params,reject_add_request:false}};
    throw new Error('不支持的群管理操作');
  }
  async function verify(p){const x=p.params;
    if(p.action==='set_friend_add_request'){if(!x.approve)return false;await contacts.refresh(true);return contacts.users().includes(p.request.userId);}
    if(p.action==='set_group_add_request')return false;
    if(p.action==='set_group_name'||p.action==='set_group_whole_ban'){const g=await call('get_group_info',{group_id:x.group_id,no_cache:true});return p.action==='set_group_name'?g.group_name===x.group_name:Number.isFinite(Number(g.group_all_shut))&&(Number(g.group_all_shut)!==0)===x.enable;}
    if(p.action==='set_group_kick'){const members=await call('get_group_member_list',{group_id:x.group_id,no_cache:true});return Array.isArray(members)&&!members.some(m=>String(m.user_id)===String(x.user_id));}
    const m=await call('get_group_member_info',{group_id:x.group_id,user_id:x.user_id,no_cache:true});
    if(p.action==='set_group_card')return m.card===x.card;
    if(p.action==='set_group_admin')return m.role===(x.enable?'admin':'member');
    if(String(m.user_id)!==String(x.user_id))return false;
    const until=Number(m.shut_up_timestamp);if(!Number.isFinite(until))return false;
    return x.duration===0?until<=now()/1000:until>now()/1000&&Math.abs(until-(now()/1000+x.duration))<=30;
  }
  return {group,
    requests:()=>Object.values(data.requests).filter(r=>r.status==='pending').map(({flag,...r})=>r).sort((a,b)=>b.at.localeCompare(a.at)),
    async ingest(event){if(event.post_type!=='request'||!['friend','group'].includes(event.request_type)||!event.flag||String(event.self_id)!==contacts.snapshot().account?.id)return;
      const id=createHash('sha256').update(`${event.self_id}:${event.request_type}:${event.flag}`).digest('hex');
      if(data.requests[id])return;data.requests[id]={id,type:event.request_type,subType:event.sub_type||'add',userId:String(event.user_id),groupId:event.group_id?String(event.group_id):null,comment:String(event.comment||'').slice(0,1000),flag:String(event.flag),status:'pending',at:new Date().toISOString()};
      const all=Object.keys(data.requests);for(const key of all.slice(0,Math.max(0,all.length-300)))delete data.requests[key];await save();
    },
    async act(input){
      if(input.confirm!==true)throw new Error('请先确认操作');if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw new Error('操作编号无效');
      const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex'),old=data.actions[input.requestId];
      if(old){if(old.fingerprint!==fingerprint)throw new Error('操作编号冲突');return structuredClone(old);}
      // Reserve before permission reads to prevent concurrent retries from performing twice.
      const entry={id:input.requestId,fingerprint,status:'running',kind:input.kind,groupId:input.groupId||null,userId:input.userId||null,source:input.source||'desktop',actorId:input.actorId||null,at:new Date().toISOString()};data.actions[input.requestId]=entry;await save();
      let p;
      try{p=await plan(input);}catch(e){entry.status='failed';entry.error=e.message;await save();throw e;}
      if(p.request){if(p.request.status!=='pending'){entry.status='failed';await save();throw new Error('申请已在处理中或已处理');}p.request.status='processing';await save();}
      try{await call(p.action,p.params);entry.status=await verify(p).catch(()=>false)?'verified':'accepted';if(p.request)p.request.status=input.approve?'approved':'rejected';}
      catch(e){entry.status='unknown';entry.error=e.message;if(p.request)p.request.status='unknown';}
      entry.message=entry.status==='verified'?'已回读 QQ 数据确认修改成功':entry.status==='accepted'?'QQ 已受理；结果尚未回读确认，请检查后再操作':'操作结果未确认，请先检查 QQ，勿重复提交';
      const keys=Object.keys(data.actions);for(const key of keys.slice(0,Math.max(0,keys.length-1000)))if(data.actions[key].status!=='running')delete data.actions[key];await save();return structuredClone(entry);
    }
  };
}
