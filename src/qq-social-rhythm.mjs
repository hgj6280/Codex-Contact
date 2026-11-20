// SurfCore-inspired rhythm, independently implemented for the existing hub.
// No scheduled messages, invented offline activities, model calls or timers.
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const QQ_RHYTHM_POLICY=Object.freeze({timeZone:'Asia/Shanghai',quietStart:'23:30',quietEnd:'08:00',burstWindowMs:10*60000,maxSpontaneousInWindow:6,closureCooldownMs:20*60000});
export function normalizeSocialRoutine(input={}, {strict=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)){if(strict)throw Error('作息设置无效');input={};}
  const next={enabled:true,quietStart:QQ_RHYTHM_POLICY.quietStart,quietEnd:QQ_RHYTHM_POLICY.quietEnd,focus:false};
  for(const key of ['enabled','focus'])if(key in input){if(typeof input[key]==='boolean')next[key]=input[key];else if(strict)throw Error('作息开关必须是布尔值');}
  for(const key of ['quietStart','quietEnd'])if(key in input){
    if(typeof input[key]==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input[key]))next[key]=input[key];
    else if(strict)throw Error('作息时间需为 HH:MM');
  }
  return next;
}
export function socialRhythm(at=Date.now(),replies=[],routine={}){
  const cfg=normalizeSocialRoutine(routine),time=clock.format(new Date(at));
  const quiet=cfg.enabled&&cfg.quietStart!==cfg.quietEnd&&(cfg.quietStart<cfg.quietEnd
    ?time>=cfg.quietStart&&time<cfg.quietEnd:time>=cfg.quietStart||time<cfg.quietEnd);
  const phase=quiet?'休息时段':time<'12:00'?'上午':time<'18:00'?'白天':time<'22:30'?'晚间':'准备休息';
  const count=replies.filter(r=>Number.isFinite(r.at)&&r.at<=at&&at-r.at<QQ_RHYTHM_POLICY.burstWindowMs).length;
  const resting=count>=QQ_RHYTHM_POLICY.maxSpontaneousInWindow;
  return {timeZone:QQ_RHYTHM_POLICY.timeZone,time,phase,quiet,focus:cfg.focus,resting,spontaneousInWindow:count,allowSpontaneous:!quiet&&!resting&&!cfg.focus};
}
export function socialRhythmPrompt(at=Date.now(),replies=[],routine={}){
  const s=socialRhythm(at,replies,routine);
  return `【角色节奏】上海时间 ${s.time}，${s.phase}。${s.focus?'专注模式：不主动另起话题；对方明确找你仍正常回应。':s.quiet?'被直接找来仍正常回应；其他时候安静休息。':s.resting?'刚主动说过不少，先听别人说；对方继续找你时正常回应。':'有具体内容才接话，留出别人说话的空间。'}作息只是主动程度的参考，不冒充真人作息或主观意识，不编造刚睡醒、喝过酒、看过视频等经历，也不用向群友播报时间或状态。`;
}
