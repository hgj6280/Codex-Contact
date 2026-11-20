export function bindGroupDigestEditor({root,api,selected}){
 const field=n=>root.querySelector(`[data-digest-${n}]`),status=field('status');let loaded='';
 async function load(){const g=selected();loaded='';if(!/^\d{5,13}$/.test(g||'')){status.textContent='请先选择需要设置的群聊。';return;}
  try{const c=await api('/api/qq/group-digest?groupId='+encodeURIComponent(g));field('hours').value=c.hours;field('users').value=c.users.join('、');field('auto').checked=c.auto.enabled;field('hour').value=c.auto.hour;field('send').checked=c.auto.sendToGroup;loaded=g;status.textContent='本群设置已读取；关注记录仅用于本群。';}catch(e){status.textContent=e.message;}}
 field('reload').onclick=load;
 field('save').onclick=async()=>{if(!loaded||selected()!==loaded){status.textContent='群聊已切换，请先重新读取。';return;}field('save').disabled=true;
  try{await api('/api/qq/group-digest',{groupId:loaded,hours:Number(field('hours').value),auto:{enabled:field('auto').checked,hour:Number(field('hour').value),sendToGroup:field('send').checked},users:field('users').value.split(/[、,，\s]+/).filter(Boolean)});status.textContent='已保存。群内发送 /群总结，或 /群总结 群友 QQ号 最近7天。';}catch(e){status.textContent=e.message;}finally{field('save').disabled=false;}};
 return {load};
}
