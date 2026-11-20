const bidi=/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
export const videoError=(code,message)=>Object.assign(new Error(message),{code});
export function parseVideoUrl(raw){
  let u;try{u=new URL(String(raw));}catch{throw videoError('INVALID_LINK','视频链接格式不正确');}
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||u.href.length>2500)throw videoError('INVALID_LINK','只接受三个平台的公开视频链接');
  const host=u.hostname.toLowerCase();let id,platform,p=1,kind='video';
  if(['bilibili.com','www.bilibili.com','m.bilibili.com'].includes(host)){
    id=u.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})(?:\/|$)/)?.[1];platform='bilibili';
    p=Number(u.searchParams.get('p')||1);if(!Number.isInteger(p)||p<1||p>1000)throw videoError('INVALID_PART','B站分P须为 1–1000 的整数');
  }else if(host==='b23.tv'){id=u.pathname.match(/^\/([a-zA-Z0-9]{3,32})\/?$/)?.[1];platform='bilibili';kind='short';}
  else if(['douyin.com','www.douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(host)){
    id=u.pathname.match(/^\/(?:video|share\/video)\/(\d{10,25})(?:\/|$)/)?.[1]||u.searchParams.get('modal_id');if(id&&!/^\d{10,25}$/.test(id))id=null;platform='douyin';
  }else if(host==='v.douyin.com'){id=u.pathname.match(/^\/([a-zA-Z0-9_-]{3,40})\/?$/)?.[1];platform='douyin';kind='short';}
  else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host)){
    id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([a-zA-Z0-9_-]{11})(?:\/|$)/)?.[1];platform='youtube';
  }else if(host==='youtu.be'){id=u.pathname.match(/^\/([a-zA-Z0-9_-]{11})\/?$/)?.[1];platform='youtube';}
  if(!id||platform==='youtube'&&!/^[a-zA-Z0-9_-]{11}$/.test(id))throw videoError('UNSUPPORTED_LINK','仅支持 B站视频、国内抖音视频和 YouTube 视频，不处理用户主页或整个播放列表');
  const url=kind==='short'?`https://${host}/${id}${platform==='douyin'?'/':''}`:platform==='bilibili'?`https://www.bilibili.com/video/${id}/?p=${p}`:platform==='youtube'?`https://www.youtube.com/watch?v=${id}`:`https://www.douyin.com/video/${id}`;
  return {platform,id,p,kind,url};
}
function cardTexts(raw){
  const result=[];
  for(const s of Array.isArray(raw?.message)?raw.message:[]){
    if(s.type==='text')result.push(String(s.data?.text||''));
    if(['json','xml'].includes(s.type)&&typeof s.data?.data==='string')result.push(s.data.data);
  }return result;
}
export function videoInputText(event){
  const r=event.replyContext,raw=r?.raw;
  const quoteAllowed=r&&(r.scopeVerified===true||event.groupId&&String(raw?.group_id)===String(event.groupId)||event.type==='private_message'&&raw?.message_type==='private'&&(String(raw.user_id)===String(event.senderId)||String(raw.user_id)===String(event.selfId)&&String(raw.target_id)===String(event.senderId)));
  return [event.text,...cardTexts(event.raw),...(quoteAllowed?[r.text,...cardTexts(raw)]:[])].filter(Boolean).join('\n').replace(bidi,'').replaceAll('&amp;','&').replaceAll('\\/','/').slice(0,32000);
}
export function extractVideoSources(event){
  const text=videoInputText(event),found=[],seen=new Set();
  const add=source=>{const key=source.url;if(!seen.has(key)){seen.add(key);found.push(source);}};
  for(const match of text.matchAll(/https?:\/\/[^\s<>"'\[\]，。；、]+/gi))try{add(parseVideoUrl(match[0].replace(/[)）!！?？]+$/,'')));}catch{/* Unsupported links are data, never fetched. */}
  for(const match of text.matchAll(/(?<![a-zA-Z0-9])(BV[a-zA-Z0-9]{10})(?![a-zA-Z0-9])/g)){
    if(found.some(s=>s.platform==='bilibili'&&s.id===match[1]))continue;
    const tail=text.slice(match.index+match[0].length,match.index+match[0].length+24),p=tail.match(/^(?:\s*[?&]p=|\s*(?:第)?[pP]\s*|\s*第)(\d{1,4})(?:[pP]|分P)?/)?.[1]||'1';
    try{add(parseVideoUrl(`https://www.bilibili.com/video/${match[1]}/?p=${p}`));}catch{}
  }return found;
}
export function videoStyle(text){return /只(?:讲|要|说)结论/.test(text)?'conclusion':/操作步骤|列.*步骤|怎么操作/.test(text)?'steps':/详细|展开/.test(text)?'detailed':/简单|简短|概括/.test(text)?'brief':'normal';}
export function stripVideoAddress(text,names=[]){
  const value=String(text||'').trim();
  for(const name of [...names].map(n=>String(n).replace(/^[@＠]/,'')).filter(Boolean).sort((a,b)=>b.length-a.length)){
    for(const at of ['@','＠'])if(value.startsWith(at+name))return value.slice(name.length+1).replace(/^[\s,，:：]+/,'');
  }
  return value;
}
function videoInstruction(text){
  // A source can precede the request ("BV…总结这个视频"). Remove only
  // recognized source tokens for intent parsing, never titles in share cards.
  return text.replace(/https?:\/\/[^\s<>"'\[\]，。；、]+/gi,token=>{
    try{parseVideoUrl(token.replace(/[)）!！?？]+$/,''));return ' ';}catch{return token;}
  }).replace(/(?<![a-zA-Z0-9])BV[a-zA-Z0-9]{10}(?![a-zA-Z0-9])(?:\s*[?&]p=\d{1,4}|\s+[pP]\s*\d{1,4})?/g,' ').replace(/^[\s@＠:：,，]+/,'').trim();
}
export function parseVideoCommand(event,{auto=false,hasContext=false,quotedVideo=false,stripMentions=text=>text}={}){
  if(String(event.senderId)===String(event.selfId)||event.desktopDraft)return null;
  const primary=Array.isArray(event.raw?.message)?event.raw.message.filter(s=>s.type==='text').map(s=>s.data?.text||'').join(''):String(event.text||'');
  const text=stripMentions(primary).replace(/\[CQ:[^\]]*\]/g,'').trim();
  const command=text.match(/^\/(?:video|视频)\s+(状态|结果|正文|取消|重试|开启自动总结|关闭自动总结|status|read|transcript|cancel|retry)(?:\s+([a-f0-9-]{8,36}))?$/i);
  if(command)return {action:({'状态':'status','结果':'read','正文':'transcript','取消':'cancel','重试':'retry','开启自动总结':'auto-on','关闭自动总结':'auto-off'})[command[1]]||command[1].toLowerCase(),id:command[2]};
  const instruction=videoInstruction(text);
  if(/(?:不要|不用|别)\s*(?:再)?\s*(?:总结|分析|解析|看这个视频)/.test(instruction))return null;
  const sources=extractVideoSources(event),explicit=/^(?:(?:请|帮我|帮忙|麻烦你?|能不能|可以|给我|先|再|详细|简短|简单)\s*)*(?:总结|概括|提炼|看看.*视频|看.*(?:视频|链接).*讲|(?:这个|这段|该)?视频.*(?:讲|说)了?什么)/.test(instruction);
  if(sources.length&&(explicit||auto))return {action:'submit',sources,style:videoStyle(text)};
  if(explicit&&(event.hasReplySegment||/视频|BV|b23\.tv|抖音|youtube|youtu\.be/i.test(text)))return {action:'missing'};
  const directed=event.type==='private_message'||event.hasSelfAtSegment||event.isReplyToSelf||event.localOperatorTest||quotedVideo||/这个视频|该视频|视频里/.test(text);
  if(hasContext&&text&&directed&&(quotedVideo||/这个视频|该视频|视频里|他说|他第.{0,4}点|第二点|最后.*结论|这个方法|这个靠谱吗|简单点|详细说|只讲结论|列操作步骤/.test(text)))return {action:'followup',sources,question:primary.replace(/\[CQ:[^\]]*\]/g,'').trim(),style:videoStyle(text)};
  return null;
}
