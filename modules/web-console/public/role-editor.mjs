export function bindRoleEditor({root,api,selected}){
  const field=name=>root.querySelector(`[data-role-${name}]`);
  const name=field('name'),aliases=field('aliases'),description=field('description'),files=field('files'),list=field('list'),status=field('status'),scopeLabel=field('scope');
  let scope='',current=null,busy=false;
  const clear=()=>{current=null;name.value='';aliases.value='';description.value='';files.value='';field('images').replaceChildren();};
  function edit(role){current=role;name.value=role.name;aliases.value=role.aliases.join('、');description.value=role.description;files.value='';
    scope=role.scope.replace(/^group:/,'');scopeLabel.textContent=role.readonly?'狐宫静 · 内置角色（统一备份，编辑仍通过专用人设设置）':'共享角色库 · 所有群聊和私聊可用';
    field('images').replaceChildren(...role.images.map(url=>{const img=document.createElement('img');img.src=url;img.alt=role.name+'参考图';img.style.cssText='max-width:100px;max-height:130px;object-fit:contain;margin:4px;border-radius:8px';return img;}));controls();}
  function controls(){for(const el of [field('save'),field('new'),field('reload'),field('delete')])el.disabled=busy||!scope;field('delete').disabled=busy||!current||current.readonly;field('save').disabled=busy||!scope||current?.readonly;field('new').disabled=busy||!selected();field('reload').disabled=busy;
    for(const el of [name,aliases,description,files])el.disabled=busy||current?.readonly;
    for(const el of [field('export'),field('import'),field('all')])el.disabled=busy;}
  async function load(){
    if(busy)return;scope=selected();clear();list.replaceChildren();controls();
    if(!scope&&!field('all').checked){scopeLabel.textContent='请先选择群聊或私聊';return;}
    scopeLabel.textContent='共享角色库 · 所有群聊和私聊可用';
    busy=true;controls();
    try{const data=await api(field('all').checked?'/api/qq/roles/library':'/api/qq/roles?conversationId='+encodeURIComponent(scope));
      for(const role of data.roles){const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent=role.name+' · '+(role.readonly?'内置':role.scope.startsWith('private:')?'私聊 '+role.scope.slice(8):'群 '+role.scope.slice(6))+' · '+role.images.length+' 张图';button.onclick=()=>edit(role);list.append(button);}
      status.textContent=data.roles.length?`统一角色库共 ${data.roles.length} 个角色；点击名字查看或编辑。${data.directory?'位置：'+data.directory:''}`:'还没有角色。填写名字和设定，可附上 1–3 张参考图。';
    }catch(e){status.textContent=e.message;}finally{busy=false;controls();}
  }
  field('new').onclick=()=>{clear();scope=selected();scopeLabel.textContent='新增到共享角色库';controls();status.textContent='正在新增角色，保存后才会生效。';};
  field('reload').onclick=load;
  field('all').onchange=load;
  field('save').onclick=async()=>{
    if(busy||current?.readonly)return;if(!current&&scope!==selected()){status.textContent='当前聊天已切换，请重新读取角色列表。';return;}
    busy=true;controls();
    try{
      const input=[...files.files];if(input.length>3||input.some(f=>f.size>5*1024*1024))throw Error('最多 3 张参考图，每张不超过 5 MB');
      const referenceImages=await Promise.all(input.map(f=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(f);} )));
      await api('/api/qq/roles',{conversationId:scope,id:current?.id,revision:current?.revision,name:name.value,aliases:aliases.value.split(/[、,，\n]/).map(x=>x.trim()).filter(Boolean),description:description.value,referenceImages});
      busy=false;await load();status.textContent='角色已保存。所有群聊和私聊下一次聊天或生图即可使用，重启后保留。';
    }catch(e){status.textContent='没有保存：'+e.message;}finally{busy=false;controls();}
  };
  field('delete').onclick=async()=>{
    if(!current||busy||current.readonly)return;if(!window.confirm('仅删除这张角色卡？原始聊天和素材保留。'))return;
    busy=true;controls();try{await api('/api/qq/roles',{conversationId:scope,action:'delete',id:current.id,revision:current.revision});busy=false;await load();}catch(e){status.textContent=e.message;}finally{busy=false;controls();}
  };
  field('export').onclick=async()=>{
    if(busy)return;busy=true;controls();status.textContent='正在打包角色卡、来源记录与全部参考图…';
    try{const data=await api('/api/qq/roles/export',{});status.textContent=`已导出到下载文件夹：${data.path}（${(data.bytes/1024/1024).toFixed(2)} MB）。新电脑安装后在此处导入即可。`;}
    catch(e){status.textContent='导出失败：'+e.message;}finally{busy=false;controls();}
  };
  field('import').onclick=async()=>{
    const file=field('import-file').files[0];if(busy)return;if(!file||file.size>32*1024*1024){status.textContent='请选择不超过 32 MB 的角色库迁移包。';return;}
    busy=true;controls();status.textContent='正在校验并合并角色库，不覆盖本机已有设定…';
    try{const archive=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      const data=await api('/api/qq/roles/import',{archive});busy=false;await load();field('import-file').value='';status.textContent=`导入完成：新增 ${data.imported} 个，已有相同 ${data.skipped} 个，冲突 ${data.conflicts.length} 个${data.builtinConflict?'；内置设定不同，保留本机版本':''}。`+(data.conflicts.length?' 未覆盖：'+data.conflicts.map(x=>x.name+'（'+x.reason+'）').join('、'):'');
    }catch(e){status.textContent='导入未完成：'+e.message;}finally{busy=false;controls();}
  };
  controls();return {load};
}
