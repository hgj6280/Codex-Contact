from pathlib import Path
import shutil
p=(Path.home() / 'Library/Application Support/WorkBuddy9Router/node_modules/9router/app/.next-cli-build/server/app/api/v1/images/generations/route.js');s=p.read_text();
if 'Reference images must be inline data URLs' in s:
 print('Multi-reference patch already installed');raise SystemExit(0)
start=s.index('let i=[{text:b.prompt}],j=b.image||Array.isArray(b.images)&&b.images[0];');end=s.index('let k=await g.execute',start)
new='let i=[{text:b.prompt}];for(let j of (Array.isArray(b.images)&&b.images.length?b.images:b.image?[b.image]:[])){if(typeof j!=="string")throw Error("Invalid reference image");let z=j.match(/^data:(image\\/[^;]+);base64,(.+)$/);if(!z)throw Error("Reference images must be inline data URLs");i.push({inlineData:{mimeType:z[1],data:z[2]}})}'
backup=p.with_suffix('.js.before-nano2-multiref');
if not backup.exists():shutil.copy2(p,backup)
s=s[:start]+new+s[end:];p.write_text(s);print('Patched image executor to preserve all inline references; original backed up')
