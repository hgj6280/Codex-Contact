export function bindFastModeToggle({root,api}) {
  const toggle=root.querySelector('[data-fast-mode-toggle]'),status=root.querySelector('[data-fast-mode-status]');
  let config=null,busy=false;
  function update(next){if(busy||!next)return;config=next;toggle.checked=next.enabled;toggle.disabled=false;}
  async function load(){if(busy)return;try{update(await api('/api/qq/fast-mode'));}catch(error){status.textContent=`读取失败：${error.message}`;}}
  toggle.disabled=true;
  toggle.addEventListener('change',async()=>{
    if(busy||!config)return;
    const previous=config,desired=toggle.checked;busy=true;toggle.disabled=true;status.textContent='正在保存…';
    try{
      config=await api('/api/qq/fast-mode',{enabled:desired,revision:previous.revision});toggle.checked=config.enabled;
      status.textContent=config.enabled?'快速模式已开启，下一个 Codex 请求生效。':'快速模式已关闭，新请求恢复普通通道。';
    }catch(error){toggle.checked=previous.enabled;status.textContent=`保存失败：${error.message}`;
      try{config=await api('/api/qq/fast-mode');toggle.checked=config.enabled;}catch{}
    }finally{busy=false;toggle.disabled=!config;}
  });
  return {update,load};
}
