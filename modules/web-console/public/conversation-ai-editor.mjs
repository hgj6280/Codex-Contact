// Selected-conversation control never calls the global channel endpoint.
// Capture the target before awaiting; changing chats cannot apply a result to
// the wrong checkbox. Polling cannot overwrite an in-flight update.
export function bindConversationAi({toggle,api,selected,conversation,notice,onRender=()=>{}}){
  let config=null,busy=false,globalEnabled=true,pending=null;
  function render(){
    const id=selected(),allowed=conversation()?.aiAllowed===true;
    toggle.disabled=busy||!config||!id||!allowed;
    toggle.checked=Boolean(allowed&&id&&config&&(pending?.id===id?pending.enabled:!config.disabledConversations.includes(id)));
    toggle.title=!allowed?'本会话尚未授权 AI，仅支持手动聊天':!globalEnabled?'AI 总开关已关闭；本会话的独立设置仍保留':
      toggle.checked?'仅关闭当前会话的 AI 自动回复':'仅开启当前会话的 AI 自动回复';
    onRender({enabled:toggle.checked,globalEnabled,authorized:allowed,loading:!config});
  }
  toggle.onchange=async()=>{
    const id=selected(),enabled=toggle.checked;
    if(busy||!config||!id)return render();
    busy=true;pending={id,enabled};render();
    try{
      config=await api('/api/qq/conversation-ai',{conversationId:id,enabled,revision:config.revision});
      notice(`已${enabled?'开启':'关闭'}该${id.startsWith('private:')?'私聊':'群聊'}的 AI 自动回复，不影响其他会话。${enabled&&!globalEnabled?'AI 总开关仍关闭，打开总开关后才会自动回复。':''}`);
    }catch(e){
      notice(`设置失败：${e.message}`);
      try{config=await api('/api/qq/conversation-ai');}catch{}
    }finally{busy=false;pending=null;render();}
  };
  return {render,update(next,enabled){globalEnabled=enabled;if(!busy&&next)config=next;render();}};
}
