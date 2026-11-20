// Only exact, enabled catalog basenames in attachment-like wrappers are
// recoverable. Never infer paths or use untrusted filenames as filesystem input.
export function normalizeStickerOutput(reply,catalog=[]){
 let text=String(reply||'');if(/\[\[qq_sticker:/.test(text))return text;
 const allowed=new Set(catalog.map(s=>s.name));let chosen=null;
 text=text.replace(/[（(]([^()（）\r\n]{1,160}\.(?:webp|png|jpe?g|gif))[）)]/gi,(whole,name)=>{
  if(!allowed.has(name)||chosen)return whole;chosen=name;return '';
 });
 if(!chosen&&allowed.has(text.trim())){chosen=text.trim();text='';}
 return chosen?[text.trim(),`[[qq_sticker:${chosen}]]`].filter(Boolean).join('\n'):text;
}
