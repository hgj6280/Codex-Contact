export function bindSendBudgetEditor({root,api}){
  if(!root)return {load:async()=>{}};
  const el=name=>root.querySelector(`[data-send-budget-${name}]`);let config=null,busy=false;
  function controls(){for(const name of ['daily','minute','save'])el(name).disabled=busy||!config;}
  function show(){el('daily').value=config.dailyLimit;el('minute').value=config.perMinute;el('status').textContent=`${config.day} · 本账号已占用 ${config.used} / ${config.dailyLimit} 条；确认成功 ${config.confirmed} 条，保守计数 ${config.uncertain} 条。剩余 ${config.remaining} 条。`;}
  async function load(){if(busy)return;try{config=await api('/api/qq/send-budget');show();}catch(e){el('status').textContent='读取发送额度失败：'+e.message;}controls();}
  el('save').onclick=async()=>{if(busy||!config)return;busy=true;controls();try{config=await api('/api/qq/send-budget',{revision:config.revision,dailyLimit:Number(el('daily').value),perMinute:Number(el('minute').value)});show();}catch(e){el('status').textContent='保存失败：'+e.message;}finally{busy=false;controls();}};
  el('reload').onclick=load;controls();return {load};
}
