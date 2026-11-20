export function bindMentions({api,drawer,notice,selected,update}){
  const $=id=>document.getElementById(id),cache=new Map();let picked=[],members=[],groupId='',pending=null;
  function chips(){const nodes=picked.map(m=>{const b=document.createElement('button');b.className='mention-chip';b.textContent=`@${m.name} ×`;b.title=`移除 @${m.id}`;b.onclick=()=>{picked=picked.filter(p=>p.id!==m.id);chips();};return b;});$('mentionChips').replaceChildren(...nodes);$('mentionChips').hidden=!nodes.length;update();}
  function render(){const term=$('mentionSearch').value.trim().toLowerCase(),matches=members.filter(m=>`${m.name} ${m.id}`.toLowerCase().includes(term)&&!picked.some(p=>p.id===m.id));
    const nodes=matches.slice(0,80).map(m=>{const b=document.createElement('button');b.className='member-row';const name=document.createElement('strong');name.textContent=m.name;const id=document.createElement('span');id.textContent=m.id;b.append(name,id);
      b.onclick=()=>{if(selected()!==groupId)return;if(picked.length>=20)return notice('一条消息最多 @20 位成员');picked.push(m);$('input').value=$('input').value.replace(/(^|\s)@[^\s@]*$/,'$1');chips();$('drawer').hidden=true;$('input').focus();};return b;});
    if(!nodes.length){const p=document.createElement('p');p.className='muted';p.textContent=members.length?'没有匹配的成员':'正在读取群成员…';nodes.push(p);}$('mentionList').replaceChildren(...nodes);
  }
  async function open(term=''){
    const id=selected();if(!/^\d{5,13}$/.test(id))return notice('请先选择一个群聊');groupId=id;drawer('mention');$('mentionSearch').value=term;
    const saved=cache.get(id);members=saved?.members||[];render();if(saved&&Date.now()-saved.at<120000)return;
    if(pending?.id===id)return;
    const work=api(`/api/qq/chat/group/${id}`);pending={id,work};try{const g=await work;cache.set(id,{at:Date.now(),members:g.members});if(groupId===id&&selected()===id){members=g.members;render();}}catch(e){notice(e.message);$('mentionList').textContent=e.message;}finally{if(pending?.work===work)pending=null;}
  }
  $('mention').onclick=()=>open();$('mentionSearch').oninput=render;
  return {ids:()=>picked.map(m=>m.id),names:()=>picked.map(m=>m.name),clear(){picked=[];chips();},conversationChanged(){picked=[];groupId='';members=[];chips();if(!$('mentionPanel').hidden)$('drawer').hidden=true;},typed(){const match=$('input').value.match(/(?:^|\s)@([^\s@]*)$/);if(match&&/^\d{5,13}$/.test(selected()))open(match[1]);},isOpen:()=>!$('drawer').hidden&&!$('mentionPanel').hidden};
}
