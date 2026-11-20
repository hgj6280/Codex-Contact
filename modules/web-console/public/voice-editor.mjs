export function bindVoiceEditor({root,api,advanced}){
  let current=null,busy=false,dirty=false;const get=name=>root.querySelector(`[data-voice-${name}]`),mode=get('mode'),enabled=get('enabled'),percent=get('percent'),rates=get('rates'),status=get('status'),save=get('save');
  const controls=()=>{for(const e of [mode,enabled,percent,rates,save])e.disabled=busy||!current;};
  for(const e of [mode,enabled,percent,rates])e.addEventListener('input',()=>{dirty=true;status.textContent='有未保存修改。';});
  function render(s){current=s;mode.value=s.qqMode||'on_request';enabled.checked=s.qqEnabled;percent.value=s.qqMixedPercent??50;rates.value=Object.entries(s.qqGroupVoiceRates||{}).map(([g,p])=>g+':'+p).join('\n');dirty=false;}
  async function load(){if(busy||dirty)return;busy=true;controls();try{render(await api('/api/life/voice'));status.textContent='仅对已开启 AI 的群聊和私聊生效；忙碌时用文字，不阻塞其他聊天。';}catch(e){status.textContent=e.message;}finally{busy=false;controls();}}
  save.onclick=async()=>{if(busy||!current)return;busy=true;controls();try{const overrides={};for(const line of rates.value.split('\n').filter(x=>x.trim())){const m=line.trim().match(/^(\d{5,15})\s*[:：]\s*(\d{1,3})%?$/);if(!m||Number(m[2])>100)throw Error('群比例格式为“群号:0至100”');overrides[m[1]]=Number(m[2]);}const latest=await api('/api/life/voice');render(await api('/api/life/voice/settings',{provider:latest.provider,qqEnabled:enabled.checked,qqMode:mode.value,qqMixedPercent:Number(percent.value),qqGroupVoiceRates:overrides}));status.textContent='回复方式已保存，下一条回复生效，无需重启或重新登录。';}catch(e){status.textContent=e.message;}finally{busy=false;controls();}};
  get('advanced').onclick=advanced;controls();return {load};
}
