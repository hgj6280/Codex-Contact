// Explicit role commands are structured operations, never drawing requests.
// Keep this pure so the bridge and the Hub use the same intent priority.
export function parseQqRoleCommand(input){
  const text=String(input||'').replace(/\[CQ:[^\]]*\]/g,'').replace(/^\s*@\d+\s*/,'').trim();
  const slash=text.match(/^\/(?:角色|role)(?:\s+([\s\S]*))?$/i);
  if(slash){
    const arg=(slash[1]||'').trim();
    if(!arg||/^(?:列表|list)$/i.test(arg))return {action:'list'};
    const action=arg.match(/^(查看|删除|show|delete)\s+(.+)$/i);
    if(action)return {action:/查看|show/i.test(action[1])?'show':'delete',name:action[2].trim()};
    return parseSave(arg.replace(/^(?:录入|保存|更新|add|save)\s+/i,''));
  }
  if(!/^(?:请|帮我|请帮我)?\s*(?:录入|登记|保存|更新|记住)(?:一下)?(?:这个|这位|新(?:的)?)?(?:角色|人物)/.test(text))return null;
  const named=text.match(/(?:角色(?:名字|名称)?|人物(?:名字|名称)?|名字|名称)(?:叫|是|为|[:：])\s*[“「"']?([^，,。；;\n”」"']{1,40})/);
  if(named)return {action:'save',name:named[1].trim(),description:''};
  return parseSave(text.replace(/^(?:请|帮我|请帮我)?\s*(?:录入|登记|保存|更新|记住)(?:一下)?(?:这个|这位|新(?:的)?)?(?:角色|人物)\s*[:：]?\s*/,''));
}
function parseSave(arg){
  const m=arg.match(/^([^\s:：，,。；;\n]{1,40})(?:\s*[:：\n]\s*([\s\S]*))?$/);
  return m?{action:'save',name:m[1],description:(m[2]||'').trim()}:{action:'help'};
}
