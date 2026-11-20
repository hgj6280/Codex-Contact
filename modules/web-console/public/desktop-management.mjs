export function bindManagement({api,drawer,notice,selected,refresh}){
  const $=id=>document.getElementById(id);let group=null,member=null,busy=false;
  const rank=role=>({member:0,admin:1,owner:2})[role]??-1;
  const roleName=role=>({member:'普通成员',admin:'管理员',owner:'群主'})[role]||'未知';
  $('syncContacts').onclick=async()=>{const button=$('syncContacts');button.disabled=true;try{const s=await api('/api/qq/chat/sync',{});if(s.stale)throw new Error(s.error||'QQ 离线，显示上次同步的通讯录');notice(`已同步 ${s.friends.length} 位好友、${s.groups.length} 个群聊；AI 授权自动同步。`);await refresh();}catch(e){notice(e.message);}finally{button.disabled=false;}};
  $('navContacts').onclick=async()=>{drawer('contacts');try{const s=await api('/api/qq/chat/conversations');const list=s.conversations;$('contactSummary').textContent=`好友 ${list.filter(c=>c.type==='private').length} · 群聊 ${list.filter(c=>c.type==='group').length}${s.directory?.stale?' · 上次同步缓存':''}`;await requests();}catch(e){notice(e.message);}};
  $('lookupFriend').onclick=async()=>{const id=$('lookupQQ').value.trim();if(!/^\d{5,13}$/.test(id))return notice('请输入正确的 QQ 号');try{const person=await api(`/api/qq/chat/lookup/${id}`);$('lookupResult').textContent=`${person.name} · ${person.id}；请在手机 QQ 添加。`;}catch(e){$('lookupResult').textContent=e.message;}};
  async function act(payload,description){
    if(busy)return false;if(!confirm(description+'\n此操作会更改真实 QQ 数据。确认执行吗？'))return false;
    busy=true;try{const result=await api('/api/qq/chat/manage',{...payload,confirm:true,requestId:crypto.randomUUID()});notice(result.message||result.error||'操作结果未确认');return ['verified','accepted'].includes(result.status);}catch(e){notice(e.message);return false;}finally{busy=false;}
  }
  async function requests(){const s=await api('/api/qq/chat/requests');const nodes=s.requests.map(r=>{const box=document.createElement('div');box.className='request-card';const title=document.createElement('strong');title.textContent=`${r.type==='friend'?'好友申请':r.subType==='invite'?'群邀请':'入群申请'} · ${r.userId}`;const text=document.createElement('p');text.textContent=[r.groupId?`群 ${r.groupId}`:'',r.comment].filter(Boolean).join(' · ');const buttons=document.createElement('div');for(const [label,approve] of [['同意',true],['拒绝',false]]){const b=document.createElement('button');b.textContent=label;b.className='quiet';b.onclick=async()=>{if(await act({kind:'request',target:r.id,approve},`${label}${title.textContent}`))await requests();};buttons.append(b);}box.append(title,text,buttons);return box;});if(!nodes.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='暂无未处理申请';nodes.push(empty);}$('requestList').replaceChildren(...nodes);}
  $('refreshRequests').onclick=()=>requests().catch(e=>notice(e.message));
  async function loadGroup(id){group=null;member=null;$('memberEditor').hidden=true;$('memberList').replaceChildren();$('groupRole').textContent='正在读取真实群权限…';$('saveGroupName').disabled=$('wholeBan').disabled=true;
    try{const g=await api(`/api/qq/chat/group/${id}`);if(selected()!==id)return;group=g;$('groupRole').textContent=`${g.name} · 我是${roleName(g.role)} · ${g.members.length} 位成员`;$('groupName').value=g.name;$('saveGroupName').disabled=$('wholeBan').disabled=rank(g.role)<1;$('wholeBan').textContent=g.wholeBan?'解除全员禁言':'开启全员禁言';renderMembers();}catch(e){$('groupRole').textContent=e.message;notice(e.message);}
  }
  $('manageGroup').onclick=()=>{const id=selected();if(!/^\d{5,13}$/.test(id))return;drawer('group');$('memberSearch').value='';loadGroup(id);};
  function renderMembers(){if(!group)return;const term=$('memberSearch').value.trim().toLowerCase();const matches=group.members.filter(m=>`${m.name} ${m.id}`.toLowerCase().includes(term));const nodes=matches.slice(0,60).map(m=>{const b=document.createElement('button');b.className='member-row';const name=document.createElement('strong');name.textContent=m.name;const detail=document.createElement('span');detail.textContent=`${m.id} · ${roleName(m.role)}`;b.append(name,detail);b.onclick=()=>{member=m;$('memberEditor').hidden=false;$('memberTitle').textContent=`${m.name} · ${m.id}`;$('memberCard').value=m.card;
      const same=m.id===group.selfId,lower=rank(m.role)<rank(group.role),admin=rank(group.role)>0;
      $('saveMemberCard').disabled=!(same||admin&&lower);$('banMember').disabled=$('kickMember').disabled=!(admin&&lower&&!same);$('setAdmin').disabled=!(group.role==='owner'&&lower&&!same);$('setAdmin').textContent=m.role==='admin'?'取消管理员':'设置管理员';$('memberEditor').scrollIntoView({block:'nearest'});};return b;});
    if(matches.length>60){const info=document.createElement('p');info.className='muted';info.textContent=`先显示 60 / ${matches.length} 位，请搜索定位成员。`;nodes.push(info);}$('memberList').replaceChildren(...nodes);}
  $('memberSearch').oninput=renderMembers;
  const current=()=>{if(!group||selected()!==group.id)throw new Error('会话已切换，请重新打开群管理');return {groupId:group.id};};
  async function edit(kind,extra,description){try{const target=current();if(await act({kind,...target,...extra},description)&&selected()===target.groupId)await loadGroup(target.groupId);}catch(e){notice(e.message);}}
  $('saveGroupName').onclick=()=>edit('name',{value:$('groupName').value},`将群 ${group?.id} 改名为“${$('groupName').value}”`);
  $('wholeBan').onclick=()=>edit('wholeBan',{enable:!group?.wholeBan},`${group?.wholeBan?'解除':'开启'}群 ${group?.id} 的全员禁言`);
  $('saveMemberCard').onclick=()=>member&&edit('card',{userId:member.id,value:$('memberCard').value},`修改 ${member.name} (${member.id}) 的群名片`);
  $('banMember').onclick=()=>member&&edit('ban',{userId:member.id,duration:Number($('banDuration').value)},`对 ${member.name} (${member.id}) 设置：${$('banDuration').selectedOptions[0].textContent}`);
  $('setAdmin').onclick=()=>member&&edit('admin',{userId:member.id,enable:member.role!=='admin'},`${member.role==='admin'?'取消':'设置'} ${member.name} (${member.id}) 的管理员身份`);
  $('kickMember').onclick=()=>member&&edit('kick',{userId:member.id},`将 ${member.name} (${member.id}) 移出群 ${group?.id}。成员需要重新申请或邀请才能加入。`);
  return {conversationChanged(){group=null;member=null;$('memberEditor').hidden=true;if(!$('groupPanel').hidden)$('drawer').hidden=true;}};
}
