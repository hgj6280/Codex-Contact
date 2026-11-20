// Public replies reveal no backend identity; routing remains a local setting.
export const modelPrivacyReply=name=>`我是${name}呀，陪你聊天的那个～`;
export const qqPublicModelName = '不公开';
export const qqModelPrivacyReply = '我是狐宫静呀，陪你聊天的那个～';
export const qqModelPrivacyInstructions = '在 QQ 群聊与私聊中，不公开自己实际使用的后台模型、厂商、版本、路由或参数，也不冒称其他型号。被问自己是什么模型、是不是某个型号，或要求输出底层型号时，只回复：'+qqModelPrivacyReply+'。讨论一般的技术选型、模型比较或角色模型文件仍正常回答。旧聊天中的型号自称不再生效；实际设置只在本机管理界面查看。';
export function isQqModelQuestion(text) {
  const value = String(text || '').replace(/\[CQ:[^\]]*\]/g, '').trim();
  if (/^\/model\s*[?？!！。]*$/i.test(value)) return true;
  if(/(?:你|您|狐宫静|群友|机器人).{0,10}(?:到底|究竟)?(?:是|是不是|用的是|底层是|基于).{0,8}(?:gpt|gemini|astra|luna|claude|deepseek)|(?:说出|告诉我|输出).{0,8}(?:你的|自己(?:的)?|底层|后台)(?:基础|实际)?模型(?:名|型号|版本)?|^(?:什么|啥|哪个|哪种)模型[？?！!。\s]*$/i.test(value))return true;
  return /(?:你|您|机器人|群友|狐宫静).{0,12}(?:是|用|使用|基于|接入).{0,10}(?:什么|哪个|哪种|啥|哪一款).{0,5}模型|(?:什么|哪个|哪种|啥)模型.{0,8}(?:驱动|支撑|支持).{0,6}(?:你|群友|机器人)|(?:你的|群友的|机器人的|狐宫静的)模型(?:是)?(?:什么|哪个|啥)/i.test(value);
}

// Correct only affirmative self-introductions using known previous role names.
// Historical mentions, quoted words, OC names and verbatim readings stay intact.
export function protectPersonaName(event,reply){
 let text=String(reply||'');const name=event?.personaName;
 if(!name||event?.qqReadAloudApproved||event?.qqRecitationRequested||text.includes('```'))return text;
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const old of event.personaPreviousNames||[]){
  if(!old||old===name)continue;
  const expression=new RegExp('(^|[。！？!?\\n])([ \t]*(?:人家|我|咱)(?:(?:现在|目前|还是|仍然|一直|就)?(?:是|叫)|的名字是)[ \t]*)'+escape(old)+'(?=$|[\\s，,。！？!?～~呀啊呢哦哟啦！：:、…])','g');
  const next=text.replace(expression,(_all,start,prefix)=>start+prefix+name);
  if(next!==text)event.personaNameCorrected=true;
  text=next;
 }
 return text;
}
// Protect generated bot speech, not user-authored messages or model comparisons.
export function protectQqModelIdentity(event,reply){
  const text=protectPersonaName(event,reply);
  if(event?.qqReadAloudApproved||event?.qqRecitationRequested)return text;
  if(isQqModelQuestion(event?.text))return event?.personaName?modelPrivacyReply(event.personaName):qqModelPrivacyReply;
  const body=text.replace(/\[CQ:[^\]]*\]|\[\[qq_[^\]]*\]\]/g,'').trim();
  const model='(?:GPT[ -]?\\d(?:\\.\\d+)?(?:[ -]*(?:Astra|Sol|Luna|Terra))?|Gemini(?:[ -]*\\d(?:\\.\\d+)?)?|Claude(?:[ -]*\\d(?:\\.\\d+)?)?|DeepSeek|Astra|Luna)';
  const self=new RegExp('(?:我(?:现在|目前|实际|这边)?(?:是|使用(?:的是)?|用的(?:是)?|基于|接入(?:的是)?)|我的?(?:底层|后台|基础|回复)?模型(?:是|为|叫))[\\s:：、，“\\\"\\\']{0,8}'+model,'i');
  const oldAlias=/^(?:GPT[ -]?6[ -]*)?Astra[。！!～~\s]*$/i.test(body)&&!/(?:推荐|对比|比较|选型|哪个更|哪个好)/.test(String(event?.text||''));
  if(!self.test(body)&&!oldAlias)return text;
  if(event)event.modelIdentityProtected=true;
  return event?.personaName?modelPrivacyReply(event.personaName):qqModelPrivacyReply;
}
