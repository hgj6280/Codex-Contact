// Narrow, version-checked repair for 9router 0.5.95's image-only adapter.
// No credentials, text-chat transformation or safety settings are changed.
export const routerTextOnlyParts='(a.parts||[]).filter(a=>void 0!==a.text).map(a=>({text:a.text}))';
export const routerImageParts='(a.parts||[]).filter(a=>void 0!==a.text||a.inlineData?.data).map(a=>void 0!==a.text?{text:a.text}:{inlineData:{mimeType:a.inlineData.mimeType||a.inlineData.mime_type,data:a.inlineData.data}})';
export function patchNanoBananaRouterExecutor(source){
  const start=source.indexOf('transformRequest(a,b,c,d){let e=d?.projectId');
  const end=source.indexOf('requestType:"image_gen"',start);
  if(start<0||end<start)throw new Error('9router 生图适配器版本变化，未修改文件');
  const region=source.slice(start,end);
  if(region.includes(routerImageParts))return source;
  if(region.split(routerTextOnlyParts).length!==2)throw new Error('9router 图片过滤器与预期不符，未修改文件');
  return source.slice(0,start)+region.replace(routerTextOnlyParts,routerImageParts)+source.slice(end);
}

export function assertNanoBananaRouterReferenceSupport(route,executor){
  if(!route.includes('Reference images must be inline data URLs')||!executor.includes(routerImageParts)){
    throw new Error('本机 9router 的参考图透传未修复；已停止请求，避免无参考图乱画。请运行 scripts/repair-nano-banana-router.mjs');
  }
}
