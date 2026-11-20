// DeepSeek official 2026-09-10 schedule: weekdays 01–04 / 06–10 UTC.
// Weekends stay off-peak, even on Chinese make-up working days.
export function referencePeak(at,policy){
 const date=new Date(at),day=date.getUTCDay(),hour=date.getUTCHours();
 const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 if(policy.holidays?.includes(localDate)||day===0||day===6)return false;
 return hour>=1&&hour<4||hour>=6&&hour<10;
}
export function referenceCost(usage,at,policy){
 const multiplier=policy.peakValley&&referencePeak(at,policy)?2:1;
 return ((usage.inputTokens-usage.cachedInputTokens)*policy.inputUsd+usage.cachedInputTokens*policy.cachedUsd+usage.outputTokens*policy.outputUsd)/1e6*multiplier;
}
