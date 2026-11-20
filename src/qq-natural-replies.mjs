// One normal model response can contain several chat bubbles. Do not split
// commands, images, code or long-form answers, or make another model call.
export function naturalReplyBubbles(event, reply) {
  const text=String(reply||'').trim();
  if(!text)return [];
  if(!event.autonomyExpected||event.desktopDraft||event.autonomyActions?.length||
    /\[\[qq_image:|```/.test(text)||Array.from(text).length>1000)return [text];
  const parts=text.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
  if(parts.length<2||parts.length>3)return [text];
  // A sticker belongs to the last text bubble, never a separate ping.
  if(parts.some(s=>!s.replace(/\[\[qq_sticker:[^\]]+\]\]/g,'').trim()))return [text];
  return parts;
}

export async function sendNaturalReply({event,reply,send,canContinue=()=>true}) {
  const bubbles=naturalReplyBubbles(event,reply),results=[],sent=[];
  for(let i=0;i<bubbles.length;i++){
    if(!canContinue(i)){results.push({ok:false,skipped:true,reason:'Conversation changed or AI disabled'});break;}
    // A timeout is uncertain delivery: stop without retrying this or later
    // bubbles. The host records each actual native send independently.
    let result;
    try{result=await send(bubbles[i],{quoteSource:i===0&&(event.autonomyQuote??false)});}
    catch(error){result={ok:false,error:error.message};}
    results.push(result);
    if(result?.ok!==true)break;
    sent.push(bubbles[i]);
  }
  return {ok:sent.length===bubbles.length,bubbles,results,sentReply:sent.join('\n\n'),partial:sent.length>0&&sent.length<bubbles.length};
}
