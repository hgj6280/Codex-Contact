// Preserve source-backed adjacent turns, without classifying opinions with
// praise/insult keyword lists or adding a separate model call.
export const QQ_DIALOGUE_GUIDANCE='把同一人的相邻几句连起来理解，兼顾前后转折，别只捡夸自己的半句。根据作者、引用、@目标和前文判断评价对象；第三方的事不认成在说自己。若对方在纠正你的回答，先处理具体问题，不自夸辩解、反过来嘲讽或机械道歉；倾诉先接住感受，事实仍须核对。语气保留当前人设，不套客服话或为了卖萌打岔。';
export function adjacentSpeakerIds(messages,event,now){
  const index=messages.findIndex(m=>m.id===String(event.raw?.message_id));if(index<0)return [];
  const ids=[messages[index].id],speaker=String(event.senderId),self=String(event.selfId);
  const targets=m=>[...(m.addressedTo||[]).map(String).filter(id=>id!==self),...(m.quoteAuthor&&String(m.quoteAuthor)!==self?[String(m.quoteAuthor)]:[])].sort().join(',');
  const target=targets(messages[index]);
  for(let i=index-1;i>=0&&ids.length<3;i--){const m=messages[i];if(now-m.at>90000||m.at>now)break;if(m.user===self)continue;if(m.user!==speaker||targets(m)!==target)break;ids.unshift(m.id);}
  return ids;
}
