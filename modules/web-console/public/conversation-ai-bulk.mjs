export function bindConversationAiBulk({root,api,conversations,onChanged}){
 const f=n=>root.querySelector(`[data-bulk-${n}]`),picked=new Set();let config=null,busy=false;
 const visible=()=>conversations().filter(c=>(f('kind').value==='all'||c.type===f('kind').value)&&(!f('search').value||`${c.name} ${c.id}`.toLowerCase().includes(f('search').value.toLowerCase())));
 function render(){const list=f('list');list.replaceChildren();for(const c of visible()){
  const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=picked.has(c.id);box.disabled=busy||c.aiAllowed!==true;box.onchange=()=>{box.checked?picked.add(c.id):picked.delete(c.id);renderCount();};
  label.append(box,document.createTextNode(`选择：${c.type==='private'?'私聊':'群聊'} · ${c.name} · ${c.id.replace('private:','')} · ${c.aiAllowed!==true?'未授权':config?.disabledConversations.includes(c.id)?'已关闭':'已开启'}`));label.className='bulk-ai-row';list.append(label);
 }renderCount();}
 function renderCount(){f('count').textContent=`已选择 ${picked.size} 个会话 · 当前开启 ${config?conversations().filter(c=>c.aiAllowed===true&&!config.disabledConversations.includes(c.id)).length:'—'} 个`; for(const n of ['on','off','all','clear'])f(n).disabled=busy||!config;}
 async function load(){if(busy)return;try{config=await api('/api/qq/conversation-ai');render();f('status').textContent='只修改选中的会话；总开关与授权范围保持不变。';}catch(e){f('status').textContent=e.message;}}
 f('search').oninput=render;f('kind').onchange=render;f('reload').onclick=load;
 f('all').onclick=()=>{for(const c of visible())if(c.aiAllowed===true)picked.add(c.id);render();};f('clear').onclick=()=>{picked.clear();render();};
 async function apply(enabled){if(busy)return;if(!config){f('status').textContent='请先刷新并读取开关设置。';return;}if(!picked.size){f('status').textContent='请先勾选会话，再点击“开启选中会话”或“关闭选中会话”；勾选本身不会改变开关。';return;}const ids=[...picked];busy=true;f('status').textContent=`正在${enabled?'开启':'关闭'} ${ids.length} 个会话，请稍候…`;render();
  try{config=await api('/api/qq/conversation-ai',{conversationIds:ids,enabled,revision:config.revision});const verified=await api('/api/qq/conversation-ai');if(ids.some(id=>!verified.disabledConversations.includes(id)!==enabled))throw Error('保存后回读状态不一致，请刷新确认');config=verified;f('status').textContent=`已保存并确认${enabled?'开启':'关闭'} ${ids.length} 个会话。${enabled?'若总开关关闭，需打开总开关才会回复。':''}`;picked.clear();await onChanged();}
  catch(e){f('status').textContent='未保存：'+e.message;try{config=await api('/api/qq/conversation-ai');}catch{}}
  finally{busy=false;render();}}
 f('on').onclick=()=>apply(true);f('off').onclick=()=>apply(false);return {load,update(next){if(!busy&&next&&config?.revision!==next.revision){config=next;render();}}};
}
