import {createHash} from 'node:crypto';
const rank=role=>({member:0,admin:1,owner:2})[role]??-1;
const help='用法：@狐宫静 /禁言 @成员 10分钟，或 @狐宫静 /解除禁言 @成员（也可填写 QQ 号）。只有本群管理员或群主可以操作。';
export function parseModerationCommand(event,strip=text=>String(text).replace(/\[CQ:at,[^\]]+\]/g,'')){
  if(!event.groupId)return null;
  const text=strip(event.text).trim().replace(/^狐宫静(?:2\.0)?[，,:：\s]*/,'');
  const match=text.match(/^\/?(禁言|解除禁言|mute|unmute)(?=\s|\d|$)\s*(.*)$/i);
  if(!match)return null;
  const unmute=/^(解除禁言|unmute)$/i.test(match[1]);let rest=match[2];
  const targets=new Set((event.atTargets||[...String(event.text).matchAll(/\[CQ:at,qq=(\d+)/g)].map(m=>m[1])).map(String).filter(id=>id!==String(event.selfId)));
  const numeric=rest.match(/^(\d{5,13})(?=\s|$)\s*/);if(numeric){targets.add(numeric[1]);rest=rest.slice(numeric[0].length);}
  if(targets.size!==1||![...targets].every(id=>/^\d{5,13}$/.test(id)))return {error:help};
  let duration=0;
  if(unmute){if(rest.trim())return {error:help};}
  else {const time=rest.trim().match(/^(\d+)\s*(秒|秒钟|分钟|分|小时|时|天|s|m|h|d)$/i);if(!time)return {error:help};
    const scale={秒:1,秒钟:1,s:1,分钟:60,分:60,m:60,小时:3600,时:3600,h:3600,天:86400,d:86400}[time[2].toLowerCase()];duration=Number(time[1])*scale;
    if(!Number.isSafeInteger(duration)||duration<=0||duration>2592000)return {error:'禁言时长需大于 0，且不超过 30 天。'};}
  return {userId:[...targets][0],duration};
}
export async function handleModerationCommand(event,{parse=parseModerationCommand(event),trusted,call,management,controllers=[]}){
  if(!parse)return null;if(!trusted)return {reply:'管理指令来源未验证，不执行。'};
  if(parse.error)return {reply:parse.error};
  try{
    if(event.raw?.message_id==null||!/^\d{5,13}$/.test(event.senderId))throw new Error('消息或发送者身份无法确认');
    const params={group_id:Number(event.groupId),no_cache:true};
    const [actor,target]=await Promise.all([call('get_group_member_info',{...params,user_id:Number(event.senderId)}),call('get_group_member_info',{...params,user_id:Number(parse.userId)})]);
    const controller=controllers.includes(event.senderId);
    if(String(actor.user_id)!==event.senderId||!controller&&rank(actor.role)<1)throw new Error('只有本群管理员或群主可以禁言和解除禁言');
    if(String(target.user_id)!==parse.userId||rank(target.role)<0)throw new Error('无法确认目标成员权限');
    if(parse.userId===event.senderId||!controller&&rank(target.role)>=rank(actor.role))throw new Error('不能操作自己或同级／更高权限成员');
    const hash=createHash('sha256').update(`${event.selfId}:${event.groupId}:${event.senderId}:${event.raw.message_id}`).digest('hex').slice(0,32);
    const requestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
    const result=await management.act({kind:'ban',groupId:event.groupId,userId:parse.userId,duration:parse.duration,confirm:true,requestId,source:'qq-command',actorId:event.senderId});
    const action=parse.duration===0?'解除禁言':`禁言 ${parse.duration%60===0?parse.duration/60+' 分钟':parse.duration+' 秒'}`;
    return {reply:result.status==='verified'?`已确认：${parse.userId} ${action}。`:result.status==='accepted'?`QQ 已受理 ${parse.userId} 的${action}，尚未确认结果。`:result.message||'操作结果未确认，请先检查 QQ，勿重复提交。'};
  }catch(e){return {reply:`未执行：${e.message}。`};}
}
