// Cheap eligibility only. Actual reference resolution belongs to the reply
// model with this conversation's evidence, never to a list of trigger words.
import {QQ_CONTEXT_POLICY} from './qq-context-window.mjs';
export const visibleChatText=text=>String(text||'').replace(/\[CQ:[^\]]*\]/g,'').normalize('NFKC').trim();
export function referencesBot(event,{names=[]}={}){
  const text=visibleChatText(event.text).toLowerCase();
  return event.hasSelfAtSegment===true||event.isReplyToSelf===true||event.replyContext?.isSelf===true||
    (event.atTargets||[]).some(id=>String(id)===String(event.selfId))||
    names.some(name=>name&&text.includes(String(name).normalize('NFKC').toLowerCase()));
}
export function contextualAttentionCandidate(event,room,identity,now){
  const text=visibleChatText(event.text);
  if(text.length<2||text.length>300||event.hasAudioSegment||!room)return null;
  const quote=event.replyContext,quotedReference=quote?.messageId&&referencesBot({text:quote.text,selfId:event.selfId},identity);
  if(quote?.raw?.group_id!=null&&String(quote.raw.group_id)!==String(event.groupId))return null;
  // QQ often appends an @ to the quoted author; only a quote actually about
  // the bot may use this path. Other directed conversations remain private.
  const others=(event.atTargets||[]).map(String).filter(id=>id!==String(event.selfId));
  if(others.some(id=>!quotedReference||id!==String(quote?.senderId)))return null;
  if(quote?.senderId&&!quote.isSelf&&!quotedReference)return null;
  const recent=(room.messages||[]).slice(-QQ_CONTEXT_POLICY.lookback).filter(m=>m.id!==String(event.raw?.message_id)&&now-m.at<=QQ_CONTEXT_POLICY.anchorAgeMs);
  const anchors=recent.filter(m=>m.selfReference).slice(-2).reverse().map(m=>m.id);
  if(quotedReference)anchors.push(String(quote.messageId));
  const directReference=referencesBot(event,identity);
  const referential=/(?:你|您|他|她|它|那[个位只]|这[个位只]|\bai\b|机器人|\bbot\b)/iu.test(text);
  const question=/[?？]|[吗么呢嘛][。.!！~～\s]*$/u.test(text);
  const explicitRole=/\bai\b|机器人|\bbot\b/iu.test(text);
  // A bare pronoun does not identify the bot in a cold/ambiguous conversation.
  if(!directReference&&!explicitRole&&!anchors.length&&text.length<9)return null;
  if(!directReference&&!quotedReference&&!(anchors.length&&(referential||question))&&!(referential&&(question||text.length<=40)))return null;
  return {anchorIds:[...new Set(anchors)],needsAnchor:!directReference&&!explicitRole&&text.length<9,
    source:quotedReference?'quoted-self-reference':anchors.length?'recent-self-reference':'possible-call'};
}
export function validateContextualAttention(attention,{event,messages=[],candidate}){
  if(!attention||attention.target!=='self'||!['summon','mention','followup'].includes(attention.intent)||!Array.isArray(attention.evidenceMessageIds))return false;
  const evidence=attention.evidenceMessageIds.map(String),current=String(event.raw?.message_id||'');
  const allowed=new Set([current,...messages.map(m=>m.id),...(candidate.anchorIds||[])]);
  if(!evidence.length||evidence.length>6||!evidence.includes(current)||evidence.some(id=>!allowed.has(id)))return false;
  return !candidate.needsAnchor||candidate.anchorIds.some(id=>evidence.includes(id));
}
