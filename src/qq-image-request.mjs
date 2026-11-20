// Shared intent parsing for queue selection, OC attachment and both providers.
// A question ABOUT drawing is not permission to start a drawing job.
import {parseQqRoleCommand} from './qq-role-intent.mjs';
export function parseQqImageRequest(input){
  const text=String(input||'').replace(/\[CQ:at,[^\]]+\]/g,'').trim();
  if(parseQqRoleCommand(text))return {requested:false,kind:'role-command',identity:{useOc:false,reason:'role-registration-not-generation'}};
  // Quoted captions are data; negative action clauses are not permission to
  // invoke the image tool. Evaluate positive clauses independently so “别改原
  // 图，画一张新图” still preserves its actual request.
  const literalFree=text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g,'[引用文字]');
  const negativeAction=/(?:不要|不用|不必|无需|别|禁止|不|do not|don't)\s*(?:再|去|真的|直接|给我|帮我)?\s*(?:生图|生成|画|绘制|绘图|制作|创作|改图|修图|重绘|draw|generate)/i;
  const clauses=literalFree.split(/[，,。；;！!？?\n]/).map(s=>s.trim()).filter(s=>s&&!negativeAction.test(s));
  const routingText=clauses.join('，');
  const imperative=/^(?:(?:请|请你|帮我|给我|麻烦你?|能不能|可以|再|重新)\s*)*(?:生图|画图|画|畫|绘制|生成|制作|创作|做一|做个|重绘|修图|改图|仿照|复刻)/i;
  const meta=/为什么|为何|怎么|怎样|如何|是不是|失败|失效|坏了|不出图|乱跑|不按(?:照)?|无法|不能正常/;
  const hasExplicitRequest=clauses.some(c=>
    (imperative.test(c)||/^(?:给|为(?!什么|何)|用|以).{1,30}(?:画|生成|绘制|制作)/.test(c))
    && !/^(?:生图|画图|绘图|生成图片)\s*(?:是不是|怎么|为什么|为何|失败|失效|坏了|不出|乱跑|无法)/.test(c));
  const discussion=!hasExplicitRequest&&meta.test(text)&&/生图|画|畫|生成|绘图/.test(text);
  const value=text.replace(/\[CQ:[^\]]*\]/g,'').replace(/\s+/g,'');
  let identity={useOc:false,reason:value.includes('狐宫静')?'address-or-non-subject':'no-oc-subject'};
  if(discussion)identity={useOc:false,reason:'discussion-not-image-command'};
  else if(/(?:不要|不用|别|不是|不想)(?:用|画|生成|换成|改成)?狐宫静|保留原(?:图)?角色/.test(value))identity={useOc:false,reason:'explicit-preserve-or-exclude-oc'};
  else{
    const drawing=/(?:生成|画|畫|绘制|制作|做|模仿|仿照|复刻)/;
    // A declared image job may describe its subject after a comma, without
    // repeating a drawing verb: “生图，狐宫静双手握拳……”.
    const declaredJob=/^(?:生图|画图|绘图|生成图片)[，,:：；;\s]/.test(text);
    for(const clause of value.split(/[，,。；;！!？?]/)){
      for(const match of clause.matchAll(/狐宫静/g)){
        const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
        let reason;
        if(/(?:给|給|为|為|用|以)$/.test(before)&&drawing.test(after))reason='oc-subject-before-drawing';
        else if(/(?:换成|改成|替换成|替换为)$/.test(before))reason='explicit-oc-replacement';
        else if(drawing.test(before)&&!/(?:给|給|送给|送給|写|写上|写着|文字|标题|署名)$/.test(before))reason='oc-subject-after-drawing';
        else if(/^的?(?:[oO][cC]|形象|表情包|头像)/.test(after)&&drawing.test(after))reason='oc-owned-image-subject';
        else if(declaredJob&&/^(?:生图|画图|绘图|生成图片)?[:：]?$/.test(before)&&after&&!/^(?:帮|给我|請|请|你|生成|画|畫|绘制|制作)/.test(after))reason='oc-declared-image-subject';
        if(reason)identity={useOc:true,reason};
      }
    }
  }
  let requested=false;
  if(!discussion){
    if(/^(?:(?:请|帮我|给我)\s*)*(?:把|将).*(?:表情包|图片|图|角色|人物).*(?:替换成|替换为|换成|改成).+/.test(routingText))requested=true;
    else if(/(?:重新生成|重新画|重新绘制)|(?:字|文字|文案|动作|姿势).{0,8}(?:错了|不对).{0,10}(?:重来|再生成|重做)/.test(routingText))requested=true;
    else if(/生成(?:一|几|两|\d+)张/.test(routingText))requested=true;
    else if(/(?:照着?|按照?|参考|模仿|仿照).{0,16}(?:原图|这张|这个图|图片|参考图).{0,16}(?:生成|来一张|做|画|改|出图)|(?:复刻|仿画|照图画)|(?:把|给|将).{0,12}(?:这张图|图片|原图).{0,16}(?:改成|换成|改为|加上|去掉|去字|换字)/i.test(routingText))requested=true;
    // A subject/pose description has no meaningful character limit. Keep the
    // action and image noun in one clause instead of cutting off after 12–16
    // characters, which routed long, valid requests into ordinary text chat.
    else requested=/生图|(?:生成|制作|创作|做)[^，,。；;！!？?\n]*(?:图|照片|头像|插画|壁纸|表情包|贴纸)|画[^，,。；;！!？?\n]*(?:表情包|头像|插画|壁纸)|(?:画|绘制|做)(?:一|个|张|幅|只|一下|帮我|给我).{0,24}|(?:帮我|给我|请你|能不能|可以).{0,8}画|画图|画画|重画|改图|修图|重绘|draw\b|generate.{0,15}(?:image|sticker|meme)/i.test(routingText);
  }
  if(!discussion&&identity.useOc&&/模仿|仿照|复刻/.test(routingText))requested=true;
  return {requested,kind:discussion?'discussion':requested?'generation':'other',identity};
}
