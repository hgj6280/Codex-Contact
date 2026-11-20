export function safeMediaUrl(value) {
  if(/^\/api\/qq\/(?:chat-media\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)|chat\/image\/[a-f0-9]{64}|chat\/sticker\/[^/?]+)$/.test(value||''))return value;
  try {const url=new URL(value);if(url.protocol==='https:'&&['multimedia.nt.qq.com.cn','gchat.qpic.cn','c2cpicdw.qpic.cn'].includes(url.hostname))return url.href;}catch{}
  return null;
}
export function recipient(id){
  if(!/^(?:private:)?\d{5,13}$/.test(id))throw new Error('请选择合法的聊天会话');
  return id.startsWith('private:')?{userId:id.slice(8)}:{groupId:id};
}
export function pollDelay(visible=true,active=true){return visible&&active?2000:15000;}
export function unreadCount(conversation,seen){return seen?.[conversation.id]&&seen[conversation.id]!==conversation.lastId?1:0;}
export function compactTokens(value){const n=Number(value)||0;return n>=1e6?`${(n/1e6).toFixed(2)}M`:n>=1000?`${(n/1000).toFixed(1)}K`:String(n);}
export function avatarInitial(value){return new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(String(value||'群'))[Symbol.iterator]().next().value.segment;}
