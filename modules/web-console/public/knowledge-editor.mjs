export function bindKnowledgeEditor({root,api,selected=()=>''}){
  if(!root)return {load:async()=>{}};
  const el=name=>root.querySelector(`[data-knowledge-${name}]`),fields=['title','source','content','scope','enabled'].map(el);
  let bound='',doc=null,config=null,busy=false,dirty=false,serial=0;
  const status=text=>{el('status').textContent=text;};
  function controls(){for(const field of fields)field.disabled=busy||!bound;for(const name of ['save','new','file','query','search','retrieval','budget','settings-save'])el(name).disabled=busy||!bound;el('delete').disabled=busy||!doc;}
  function clear(){doc=null;el('title').value='';el('source').value='';el('content').value='';el('scope').value='conversation';el('enabled').checked=true;dirty=false;controls();}
  function current(){if(!bound||bound!==selected()){status('会话已切换，请先重新读取资料；未保存的文本仍保留。');return false;}return true;}
  async function list(){
    const id=bound,token=++serial,data=await api(`/api/qq/knowledge?conversationId=${encodeURIComponent(id)}&query=${encodeURIComponent(el('query').value)}`);
    if(token!==serial||id!==bound||id!==selected())return;
    config=data.settings;el('retrieval').checked=config.enabled;el('budget').value=String(config.budget);
    el('scope-label').textContent=`当前资料会话：${id.startsWith('private:')?'私聊 '+id.slice(8):'群 '+id} · ${data.total} 篇`;
    const nodes=data.documents.map(row=>{
      const item=document.createElement('div'),button=document.createElement('button'),preview=document.createElement('p');button.type='button';button.className='quiet wide';button.textContent=`${row.title} · ${row.scope==='shared'?'共享':'本会话'}${row.enabled?'':' · 已停用'}`;
      preview.className='muted';preview.textContent=row.preview;
      button.onclick=async()=>{
        if(busy||!current()||dirty&&!window.confirm('放弃当前未保存修改，读取这篇资料？'))return;
        busy=true;controls();try{const data=await api(`/api/qq/knowledge?conversationId=${encodeURIComponent(bound)}&id=${row.id}`);if(!current())return;doc=data.document;for(const name of ['title','source','content','scope'])el(name).value=doc[name];el('enabled').checked=doc.enabled;dirty=false;status('正在编辑；修改前的版本会保留在本机备份中。');}catch(e){status(e.message);}finally{busy=false;controls();}
      };item.append(button,preview);return item;
    });
    if(data.total>20){const p=document.createElement('p');p.className='muted';p.textContent='先显示最近20篇，输入关键词查找其他资料。';nodes.push(p);}
    if(!nodes.length){const p=document.createElement('p');p.className='muted';p.textContent='暂时没有资料，可以新建或导入 TXT / Markdown。';nodes.push(p);}el('list').replaceChildren(...nodes);
  }
  async function load({force=false}={}){
    if(busy||dirty&&!force)return;
    if(force&&dirty&&!window.confirm('放弃当前未保存修改，重新读取？'))return;
    const id=selected();if(!id){status('请先选择要使用资料的群聊或私聊。');return;}
    bound=id;busy=true;controls();try{await list();if(bound===selected()){clear();status('按问题检索相关片段，不会每轮发送整份资料。');}}catch(e){status('读取失败：'+e.message);bound='';}finally{busy=false;controls();}
  }
  for(const field of fields)field.addEventListener('input',()=>{dirty=true;status('尚未保存，保存后下一条回复才会使用。');});
  el('reload').onclick=()=>load({force:true});el('search').onclick=async()=>{if(!current())return;try{await list();}catch(e){status(e.message);}};
  el('new').onclick=()=>{if(current()&&(!dirty||window.confirm('放弃当前未保存修改，新建资料？'))){clear();status('填写资料后保存。默认仅当前会话可用。');}};
  el('save').onclick=async()=>{
    if(busy||!current())return;busy=true;controls();
    try{const document={title:el('title').value,source:el('source').value,content:el('content').value,scope:el('scope').value,enabled:el('enabled').checked,...doc?{id:doc.id,revision:doc.revision}:{}};const result=await api('/api/qq/knowledge',{conversationId:bound,action:'save',document});doc=result.document;dirty=false;await list();status('资料已保存，下一条相关回复可使用；聊天记录和角色库没有改动。');}catch(e){status('保存失败：'+e.message);}finally{busy=false;controls();}
  };
  el('delete').onclick=async()=>{
    if(busy||!doc||!current()||!window.confirm('删除这篇资料并停止检索？不会删除QQ聊天或角色资料。'))return;
    busy=true;controls();try{await api('/api/qq/knowledge',{conversationId:bound,action:'delete',id:doc.id,revision:doc.revision});clear();await list();status('已删除，旧版保留在本机资料备份中。');}catch(e){status(e.message);}finally{busy=false;controls();}
  };
  el('settings-save').onclick=async()=>{
    if(busy||!config||!current())return;busy=true;controls();try{const data=await api('/api/qq/knowledge',{conversationId:bound,action:'settings',settings:{enabled:el('retrieval').checked,budget:Number(el('budget').value),revision:config.revision}});config=data.settings;status('已保存当前会话的资料检索设置。');}catch(e){status(e.message);}finally{busy=false;controls();}
  };
  el('file').onchange=async()=>{
    const file=el('file').files?.[0];if(!file||!current())return;
    try{if(!/\.(txt|md|markdown)$/i.test(file.name)||file.size>800000)throw Error('请选择不超过800KB的UTF-8 TXT或Markdown文件');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()).replace(/^\uFEFF/,'');if(!current())return;if(!text.trim()||text.length>200000||text.includes('\0'))throw Error('正文须为非空文本，最多20万字');clear();el('title').value=file.name.slice(0,120);el('source').value=('手工导入：'+file.name).slice(0,200);el('content').value=text;dirty=true;status('已载入文件预览，核对内容和范围后点击保存才会入库。');}catch(e){status('导入失败：'+e.message);}finally{el('file').value='';}
  };
  controls();return {load};
}
