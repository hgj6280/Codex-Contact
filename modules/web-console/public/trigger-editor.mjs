// Shared settings editor. Reads only on opening/reload, never overwrites edits
// from chat polling. Toggle writes the saved list, not unfinished text.
export function bindTriggerEditor({root,api,confirmReload=()=>confirm('重新读取会丢弃未保存的触发词修改，继续吗？')}) {
  const element=name=>root.querySelector(`[data-trigger-${name}]`);
  const text=element('text'),toggle=element('toggle'),save=element('save'),reload=element('reload'),status=element('status');
  let config=null,busy=false;
  const dirty=()=>config && text.value!==config.words.join('\n');
  function controls(){for(const el of [text,toggle,save])el.disabled=!config||busy;reload.disabled=busy;}
  function render(next){config=next;text.value=next.words.join('\n');toggle.checked=next.enabled;}
  async function load({force=false}={}){
    if(busy || (config&&!force))return;
    if(dirty()&&!confirmReload())return;
    busy=true;controls();status.textContent='正在读取触发词…';
    try{render(await api('/api/qq/triggers'));status.textContent=config.enabled?'关键词触发已开启，任意一个词命中即可回复。':'关键词触发已关闭，已保存的词仍保留。';}
    catch(e){status.textContent=`读取失败：${e.message}，可点「重新读取」重试。`;}
    finally{busy=false;controls();}
  }
  async function write(enabled,words){
    if(busy||!config)return;
    busy=true;controls();status.textContent='正在保存…';
    try{render(await api('/api/qq/triggers',{enabled,words,revision:config.revision}));status.textContent=`已保存，关键词触发已${config.enabled?'开启':'关闭'}；下一条新消息生效，无需重新登录。`;}
    catch(e){toggle.checked=config.enabled;status.textContent=`保存失败：${e.message}。修改仍在编辑框中，可点「重新读取」同步。`;}
    finally{busy=false;controls();}
  }
  text.addEventListener('input',()=>{status.textContent='有未保存修改，点击「保存触发词」后生效。';});
  save.addEventListener('click',()=>write(toggle.checked,text.value));
  toggle.addEventListener('change',()=>{
    if(dirty()){toggle.checked=config.enabled;status.textContent='请先保存触发词修改，再切换开关。';return;}
    return write(toggle.checked,config.words);
  });
  reload.addEventListener('click',()=>load({force:true}));
  controls();return {load};
}
