export function bindCompanionEditor({root,api,selected=()=>''}){
  const field=name=>root.querySelector(`[data-companion-${name}]`);
  const enabled=field('enabled'),emotion=field('emotion'),natural=field('natural'),save=field('save'),status=field('status'),user=field('user'),read=field('read'),list=field('list');
  const diary=field('diary'),idle=field('idle');
  const forgetting=field('forgetting'),routine=field('routine'),quietStart=field('quiet-start'),quietEnd=field('quiet-end'),focus=field('focus');
  const inputs=[enabled,emotion,natural,diary,idle,forgetting,routine,quietStart,quietEnd,focus].filter(Boolean);
  let config=null,busy=false,dirty=false;
  const controls=()=>{for(const el of inputs)el.disabled=busy||!config;for(const el of [quietStart,quietEnd].filter(Boolean))el.disabled=busy||!config||!routine?.checked;save.disabled=busy||!config||!dirty;};
  async function load(){
    if(busy||dirty)return;
    try{
      config=await api('/api/qq/companion/settings');enabled.checked=config.enabled;emotion.checked=config.emotion;natural.checked=config.naturalReplies;
      if(diary)diary.checked=config.diary;if(idle)idle.checked=config.idleFollowups;
      if(forgetting)forgetting.checked=config.forgetting!==false;
      if(routine)routine.checked=config.routine?.enabled!==false;if(focus)focus.checked=config.routine?.focus===true;
      if(quietStart)quietStart.value=config.routine?.quietStart||'23:30';if(quietEnd)quietEnd.value=config.routine?.quietEnd||'08:00';
      status.textContent=`已记录 ${config.facts} 条长期记忆、${config.diaryEntries||0} 条日记片段；${config.pending} 条待合批整理，${config.pendingFollowups||0} 个待择机话题。${config.lastError?'上次后台整理未完成，不影响正常回复。':''}`;
      if(config.presence)status.textContent+=config.presence.focus?' 当前专注中，暂停主动搭话。':config.presence.quiet?' 当前为安静时段。':' 当前可择机主动聊天。';
      if(selected().startsWith('private:'))user.value=selected().slice(8);
    }catch(e){status.textContent=`读取失败：${e.message}`;}controls();
  }
  for(const el of inputs)el.addEventListener('change',()=>{dirty=true;controls();status.textContent='尚未保存。关闭功能不会删除已有记忆。';});
  save.addEventListener('click',async()=>{
    if(busy||!config)return;busy=true;controls();
    try{config=await api('/api/qq/companion/settings',{enabled:enabled.checked,emotion:emotion.checked,naturalReplies:natural.checked,...diary?{diary:diary.checked}:{},...idle?{idleFollowups:idle.checked}:{},...forgetting?{forgetting:forgetting.checked}:{},...routine?{routine:{enabled:routine.checked,quietStart:quietStart.value,quietEnd:quietEnd.value,focus:focus.checked}}:{},revision:config.revision});dirty=false;status.textContent='已保存，作息与记忆设置即时生效；普通聊天和生图设置未改变。';}
    catch(e){status.textContent=`保存失败：${e.message}；请重新打开设置后重试。`;try{const latest=await api('/api/qq/companion/settings');config={...config,revision:latest.revision};}catch{}}
    finally{busy=false;controls();}
  });
  async function loadMemories(){
    const conversationId=selected(),userId=user.value.trim();
    if(!conversationId||!/^\d{5,13}$/.test(userId)){status.textContent='请先在聊天页选择群／私聊，再填写要查看的 QQ 号。';return;}
    read.disabled=true;
    try{
      const data=await api(`/api/qq/companion/memories?conversationId=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}`);
      const nodes=data.memories.map(memory=>{
        const row=document.createElement('div'),text=document.createElement('p'),source=document.createElement('small'),remove=document.createElement('button'),edit=document.createElement('button');
        text.textContent=memory.content;source.textContent=`${memory.retention?.label?memory.retention.label+' · ':''}来源：${memory.evidence} · ${new Date(memory.at).toLocaleDateString('zh-CN')}${memory.retention?.active===false?' · 保留在存档，需要时可查回':''}`;
        remove.textContent='忘记这条';remove.type='button';remove.className='quiet';
        edit.textContent='更正';edit.type='button';edit.className='quiet';
        edit.addEventListener('click',async()=>{
          const content=window.prompt('更正这条记忆（最多 240 字，不修改原聊天记录）',memory.content);
          if(content===null)return;edit.disabled=true;
          try{await api('/api/qq/companion/memories',{conversationId,userId,action:'update',id:memory.id,content});await loadMemories();}
          catch(e){status.textContent=`更正未完成：${e.message}`;edit.disabled=false;}
        });
        remove.addEventListener('click',async()=>{
          if(!window.confirm('删除这条派生记忆及本人的关联召回片段？QQ 原始聊天记录不会删除。'))return;
          remove.disabled=true;
          try{await api('/api/qq/companion/memories',{conversationId,userId,action:'forget',id:memory.id});await loadMemories();}
          catch(e){status.textContent=`删除未完成：${e.message}`;remove.disabled=false;}
        });
        const pin=document.createElement('button');pin.type='button';pin.className='quiet';
        pin.textContent=memory.retention?.pinned?'取消置顶':memory.retention?.protected?'长期保留':'置顶';pin.disabled=memory.retention?.protected&&!memory.retention?.pinned;
        pin.addEventListener('click',async()=>{pin.disabled=true;try{await api('/api/qq/companion/memories',{conversationId,userId,action:'pin',id:memory.id,pinned:pin.textContent==='置顶'});await loadMemories();}catch(e){status.textContent=e.message;pin.disabled=false;}});
        row.append(text,source,pin,edit,remove);return row;
      });
      if(!nodes.length){const empty=document.createElement('p');empty.textContent='这个会话中暂时没有该群友的长期记忆。';nodes.push(empty);}
      if(data.diary?.length){
        const title=document.createElement('p');title.textContent='互动日记 · 仅此会话、此人';nodes.push(title);
        for(const entry of data.diary){const row=document.createElement('p');row.textContent=`${entry.day} · 我记得对方说过：${entry.content}（原话：${entry.evidence}）`;nodes.push(row);}
      }
      if(data.purposes?.length){const title=document.createElement('p');title.textContent='想接着聊的事 · 只是有来源的候选，不是已完成事实';nodes.push(title);for(const p of data.purposes){const row=document.createElement('p');row.textContent=`${p.topic} → ${p.nextStep}（${p.status}；依据：${p.evidence}）`;nodes.push(row);}}
      list.replaceChildren(...nodes);status.textContent='只展示所选会话、该 QQ 号的记忆；聊天中可用 /remember 内容 明确记录。';
    }catch(e){status.textContent=`读取失败：${e.message}`;}finally{read.disabled=false;}
  }
  field('archive')?.addEventListener('click',async()=>{
    const conversationId=selected(),userId=user.value.trim(),button=field('archive'),container=field('archive-list');
    if(!conversationId||!/^\d{5,13}$/.test(userId)){status.textContent='请先选择聊天并填写 QQ 号。';return;}
    button.disabled=true;
    try{const data=await api(`/api/qq/companion/archive?conversationId=${encodeURIComponent(conversationId)}&userId=${userId}&query=${encodeURIComponent(field('archive-query').value)}`);container.replaceChildren();
      for(const item of data.entries){const row=document.createElement('p');row.textContent=`${new Date(item.at).toLocaleDateString('zh-CN')} · ${item.kind==='exchange'?'真实互动原话':item.current?'当前事实来源':'历史版本，不能当作当前事实'}：${item.content}${item.reply?' → 狐宫静：'+item.reply:''}`;container.append(row);}
      status.textContent=`存档共 ${data.total} 条；本页最多 25 条，更多内容请用关键词搜索。包含启用后与此前仍保留的资料，不补造丢失历史。`;
    }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
  });
  read.addEventListener('click',loadMemories);controls();return {load};
}
