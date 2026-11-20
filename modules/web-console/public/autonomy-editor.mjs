export function bindAutonomyEditor({root,api,selected}){
  const field=k=>root.querySelector(`[data-autonomy-${k}]`),flags=['enabled','contextualReplies','friendRequests','privateMessages','moderation','highEqEnabled','socialPlannerEnabled','dynamicRhythmEnabled','replyCooldownEnabled'],probabilities=['passiveProbability','topicProbability','quoteProbability','atProbability'];
  let config=null,target='',dirty=false,busy=false;
  const status=field('status'),save=field('save'),local=field('conversation'),controllers=field('controllers');
  const render=()=>{for(const k of [...flags,...probabilities,'interval','limit','mute'])if(field(k))field(k).disabled=busy||!config;local.disabled=busy||!config||!target;controllers.disabled=busy||!config;save.disabled=busy||!config||!dirty;};
  async function load(){
    if(busy||dirty)return;
    try{config=await api('/api/qq/autonomy');target=selected();for(const k of flags)if(field(k))field(k).checked=config[k]!==false;for(const k of probabilities)if(field(k))field(k).value=config[k];
      local.checked=!!target&&!config.disabledConversations.includes(target);controllers.value=config.controllers.join('，');
      field('target').textContent=target?`当前会话：${target}（原有 AI 总开关和本会话 AI 开关仍优先）`:'先在聊天页选择要单独设置的会话。';
      field('interval').value=config.minIntervalSeconds;field('limit').value=config.maxPerHour;field('mute').value=config.maxMuteMinutes;
      const names={decision:'接话判断',action:'QQ操作','spontaneous-reply':'主动接话','friend-review':'好友审核'};
      field('log').textContent=config.recentActions.length?config.recentActions.slice(0,12).map(a=>`${new Date(a.at).toLocaleTimeString('zh-CN')} ${a.contextual?'上下文呼唤/提及':names[a.kind]||a.kind} ${a.type||''} · ${a.status}\n${a.reason||''}${a.contextWindow?'\n本次参考 '+a.contextWindow.selected+' / '+a.contextWindow.available+' 条消息，'+a.contextWindow.chars+' 字符':''}${a.attention?'\n判断对象：'+({self:'狐宫静',other:'其他群友',unclear:'不确定'}[a.attention.target]||'不确定')+'；依据消息：'+a.attention.evidenceMessageIds.join('、'):''}`).join('\n\n'):'还没有自主判断或操作记录。';
      status.textContent=`已读取。${config.presence?`当前：${config.presence.phase}（上海时间 ${config.presence.time}）${config.presence.resting?'，主动接话较多，先旁听':''}。`:''}普通回复不增加一次模型调用；关闭不会删除聊天和记忆。`;
    }catch(e){status.textContent='读取失败：'+e.message;}render();
  }
  for(const input of root.querySelectorAll('input'))input.addEventListener('change',()=>{dirty=true;status.textContent='尚未保存；本会话设置只作用于上方显示的会话。';render();});
  save.onclick=async()=>{
    if(!config||busy)return;busy=true;render();
    const body={revision:config.revision,controllers:controllers.value.split(/[,，\s]+/).filter(Boolean),minIntervalSeconds:Number(field('interval').value),maxPerHour:Number(field('limit').value),maxMuteMinutes:Number(field('mute').value)};
    for(const k of flags)if(field(k))body[k]=field(k).checked;for(const k of probabilities)if(field(k))body[k]=Number(field(k).value);if(target)body.conversation={id:target,enabled:local.checked};
    try{config=await api('/api/qq/autonomy',body);dirty=false;status.textContent='已保存，下一条消息生效；不会打开原本关闭 AI 的会话。';}
    catch(e){status.textContent='保存失败：'+e.message;}
    finally{busy=false;render();}
  };
  field('reload').onclick=()=>{dirty=false;load();};render();return {load};
}
