export function bindImageModelEditor({root,api}){
  const provider=root.querySelector('[data-image-provider]'),fallback=root.querySelector('[data-image-fallback]'),
    save=root.querySelector('[data-image-save]'),status=root.querySelector('[data-image-status]');
  let config=null,busy=false,dirty=false;
  function controls(){provider.disabled=busy||!config;fallback.disabled=busy||!config||provider.value!=='nano-banana-2';save.disabled=busy||!config||!dirty;}
  function update(next){if(!next||busy||dirty)return;config=next;provider.value=next.provider;fallback.checked=next.fallbackToGpt===true;controls();}
  async function load(){if(busy||dirty)return;try{update(await api('/api/qq/image-model'));}catch(error){status.textContent=`读取失败：${error.message}`;}}
  const changed=()=>{dirty=true;controls();status.textContent='尚未保存；只影响生图，不改变文字回复模型。';};
  provider.addEventListener('change',changed);fallback.addEventListener('change',changed);
  save.addEventListener('click',async()=>{
    if(busy||!config||!dirty)return;
    busy=true;controls();status.textContent='正在保存…';
    try{
      const next=await api('/api/qq/image-model',{provider:provider.value,fallbackToGpt:fallback.checked,revision:config.revision});
      busy=false;dirty=false;update(next);
      status.textContent=next.provider==='nano-banana-2'
        ?`已选 Gemini · Nano Banana 2${next.fallbackToGpt?'；额度不足时回退 GPT-6 Luna':'；不自动回退'}。下一条生图生效。`
        :`已选 GPT · ${next.gptModel}，不影响文字聊天。下一条生图生效。`;
    }catch(error){
      status.textContent=`保存失败：${error.message}；修改仍保留，可重试。`;
      // Refresh only the revision; retain the user's pending choice, even when
      // this transport does not expose HTTP status on errors.
      try{config=await api('/api/qq/image-model');}catch{}
    }
    finally{busy=false;controls();}
  });
  controls();return {update,load};
}
