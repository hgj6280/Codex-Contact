// Concision belongs in the prompt, not a blind 900-character substring that
// breaks sentences, emoji or outgoing image markers. Keep useful long answers;
// only pathological output hits this transport safety ceiling.
export function qqResponseIntent(input){
  const text=String(input||'').replace(/\[CQ:[^\]]*\]/g,'').trim();
  const textOnly=/(?:用|以|发|改成|换成).{0,3}文字|文字(?:来|回复|回答|罗列|列出)|(?:不要|别|不用|停止|关闭).{0,5}语音|^\/text\b/i.test(text);
  const detailed=/(?:详细|完整|具体|展开)(?:地|一点|些|的|来|说明|解释|介绍|讲|说|列|罗列|回答)|(?:都|全部|逐项|逐条).{0,4}(?:列|解释|说)|(?:列出|罗列|盘点)|长(?:一点|点|些|消息|文)|(?:至少|大约|写|要)\s*\d{3,5}\s*字|(?:前|第)?(?:十|[1-9]\d?)[大项条个]/.test(text)&&!/(?:不要|不用|别)(?:再|太|这么|那么|写得|说得|写|说)?(?:详细|展开|长篇|长文|长消息)|简短(?:回答|回复)|只(?:要|说|讲)结论/.test(text);
  return {textOnly,detailed};
}
export const QQ_LONG_REPLY_GUIDANCE='本轮明确要求详细说明、罗列或长文字：优先回答当前这条消息的主题，不续答已换掉的旧话题。按要求完整展开、分项和给足所请求的项目数；日常短句、卖萌及气泡数偏好不能截断正文。资料不足就明确标注，不编造权威排名；只输出正文，程序会按QQ长度分段。';
export function splitQqLongReply(reply,maxChars=1800){
  const chars=Array.from(String(reply||'').toWellFormed()),parts=[];let start=0;
  while(chars.length-start>maxChars){let end=start+maxChars;for(let i=end;i>start+Math.floor(maxChars*.65);i--)if(/[\n。！？.!?]/.test(chars[i-1])){end=i;break;}
    const prefix=chars.slice(start,end).join(''),open=prefix.lastIndexOf('[['),close=prefix.lastIndexOf(']]');if(open>0&&open>close)end=start+Array.from(prefix.slice(0,open)).length;
    if(end<=start)end=start+maxChars;parts.push(chars.slice(start,end).join(''));start=end;
  }if(start<chars.length)parts.push(chars.slice(start).join(''));return parts;
}
export async function sendQqLongReply(reply,send){
  const parts=splitQqLongReply(reply),results=[],sent=[];
  for(let i=0;i<parts.length;i++){let r;try{r=await send(parts[i],i);}catch(e){r={ok:false,error:e.message};}results.push(r);if(!r?.ok)break;sent.push(parts[i]);}
  return {ok:sent.length===parts.length,partial:sent.length>0&&sent.length<parts.length,sentReply:sent.join(''),results,body:results[0]?.body,error:results.at(-1)?.error};
}
export function limitQqReplyText(reply, {maxLength = 6000} = {}) {
  const value = String(reply || '').toWellFormed();
  if (Array.from(value).length <= maxLength) return value;
  const markers = [...value.matchAll(/\[\[qq_(?:image|sticker):[^\]\r\n]+\]\]/g)].map(m=>m[0]);
  const body = value.replace(/\[\[qq_(?:image|sticker):[^\]\r\n]+\]\]/g, '').trim();
  const suffix = '…（回复过长，后续内容已省略）';
  const budget = Math.max(0, maxLength - Array.from(suffix + markers.join('\n')).length - 3);
  const chars = Array.from(body).slice(0, budget);
  let end = chars.length;
  for (let i = chars.length - 1; i >= Math.floor(chars.length * .65); i--) {
    if (/[。！？!?\n]/.test(chars[i])) { end = i + 1; break; }
  }
  return [chars.slice(0, end).join('').trimEnd() + '\n' + suffix, ...markers].join('\n');
}
