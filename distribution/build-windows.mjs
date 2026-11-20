import {mkdir,readdir,readFile,writeFile,copyFile,mkdtemp} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=fileURLToPath(new URL('../',import.meta.url));
const version='1.1.0';
const stage=await mkdtemp(join(tmpdir(),'qq-friend-windows-'));
const root=join(stage,'QQFriend-Windows');
await mkdir(root,{recursive:true});
async function copyTree(source,target,filter=()=>true){await mkdir(target,{recursive:true});for(const e of await readdir(source,{withFileTypes:true})){if(e.isSymbolicLink())continue;if(!filter(e.name,e.isDirectory()))continue;const a=join(source,e.name),b=join(target,e.name);if(e.isDirectory())await copyTree(a,b,filter);else await copyFile(a,b);}}
await copyTree(join(repo,'distribution/windows'),root);
await copyTree(join(repo,'src'),join(root,'app/src'),(name,dir)=>dir||/\.(mjs|js)$/.test(name)&&!name.includes('.test.'));
await mkdir(join(root,'app/scripts'),{recursive:true});
await copyFile(join(repo,'scripts/qq-admin-fetch.mjs'),join(root,'app/scripts/qq-admin-fetch.mjs'));
await copyTree(join(repo,'modules/web-console/public'),join(root,'app/modules/web-console/public'));
await copyTree(join(repo,'modules/qq-napcat'),join(root,'app/modules/qq-napcat'),(name,dir)=>!dir&&['bridge.mjs','conversation-queue.mjs'].includes(name));
await mkdir(join(root,'app/data/qq-stickers'),{recursive:true});
await copyFile(join(repo,'data/qq-soul.md'),join(root,'app/data/qq-soul.md'));
await mkdir(join(root,'app/assets/qq-character/hugongjing'),{recursive:true});
for(const name of ['appearance.md','reference-default.png','reference-summer.png'])await copyFile(join(repo,'assets/qq-character/hugongjing',name),join(root,'app/assets/qq-character/hugongjing',name));
await writeFile(join(root,'package.json'),JSON.stringify({name:'qq-friend-windows',version,private:true,type:'module',engines:{node:'>=24'},dependencies:{sharp:'0.34.5'}},null,2));
const lockPath=join(root,'package-lock.json');
const packageLock=JSON.parse(await readFile(lockPath,'utf8'));
packageLock.version=version;packageLock.packages[''].version=version;
await writeFile(lockPath,JSON.stringify(packageLock,null,2));
await writeFile(join(root,'app/package.json'),'{"type":"module","private":true}');
async function patch(path,find,replacement){let s=await readFile(path,'utf8');if(!s.includes(find))throw Error(`Source changed: ${path}: ${find}`);s=s.replace(find,replacement);await writeFile(path,s);}
const server=join(root,'app/src/server.js');
await patch(server,'const codexHomeDir = join(process.env.HOME || "", ".codex");','const codexHomeDir = join(process.env.HOME || process.env.USERPROFILE || "", ".codex");');
await patch(server,'    qq: false,\n    imessage: true','    qq: true,\n    imessage: false');
await patch(server,'const child = spawn(codexCliPath, args, {','const child = spawn(process.execPath, [codexCliPath, ...args], {');
// Keep all management actions local; Windows package has no macOS control route.
await patch(server,'async function handleApi(req, res) {',`async function handleApi(req, res) {
  if(req.headers.origin && req.headers.origin !== 'http://127.0.0.1:3789' && req.headers.origin !== 'http://localhost:3789') return sendJson(res,403,{error:'Local panel origin required'});
  if(['/api/imessage','/api/proxy','/api/remote-execution'].some(p=>req.url?.startsWith(p))) return sendJson(res,400,{error:'Unavailable in Windows QQ edition'});
  if(req.method==='POST'&&req.url==='/api/channel'){
    const body=await readBody(req);if(body.channel!=='qq')return sendJson(res,400,{error:'Only QQ is available'});
    state.channels.qq=Boolean(body.enabled);await saveSettings();return sendJson(res,200,buildPublicState());
  }
`);
// Actual poller is synchronous: leave definition intact, disable every call.
let serverText=await readFile(server,'utf8');
serverText=serverText.replaceAll('updateIMessagePoller();','/* iMessage unavailable on Windows */');
serverText=serverText.replaceAll('"--ignore-user-config",','').replaceAll('"--ignore-rules",','');
serverText=serverText.replace('await loadSettings();',`await loadSettings();
state.channels.imessage=false;
`);
serverText=serverText.replace('state.qq.allowedGroups = normalizeAllowedGroups(body.allowedGroups);',`state.qq.allowedGroups = normalizeAllowedGroups(body.allowedGroups);
      const bridgePath=join(projectDir,'modules/qq-napcat/state/bridge.json');
      const bridgeConfig=JSON.parse(await readFile(bridgePath,'utf8'));
      bridgeConfig.allowedGroups=state.qq.allowedGroups;
      await saveJsonAtomic(bridgePath,bridgeConfig);`);
await writeFile(server,serverText);
// Cross-platform image conversion replaces sips without touching the Mac copy.
for(const file of ['qq-media.mjs','qq-codex-images.mjs']){
  const path=join(root,'app/src',file);let s=await readFile(path,'utf8');
  s=s.replaceAll("execFileAsync('/usr/bin/sips', [","execFileAsync(process.execPath, [fileURLToPath(new URL('../../image-convert.mjs',import.meta.url)), ");
  if(!s.includes("from 'node:url'"))s="import { fileURLToPath } from 'node:url';\n"+s;
  await writeFile(path,s);
}
await patch(join(root,'app/src/qq-image-quality.mjs'),"command = '/opt/homebrew/bin/tesseract'","command = process.env.QQ_TESSERACT_PATH || 'tesseract'");
// Hide unavailable platform controls and personal preset target numbers.
const htmlPath=join(root,'app/modules/web-console/public/client.html');let html=await readFile(htmlPath,'utf8');
html=html.replaceAll('20010','（安装配置中的群号）').replaceAll('10010','（安装配置中的参与者）');
html=html.replace('<head>','<head><style>.switch-card:has(#imessageToggle),section:has(#handleList){display:none!important}</style>');
await writeFile(htmlPath,html);
const desktopPath=join(root,'app/modules/web-console/public/desktop.js');
await patch(desktopPath,"function nativeAction(action,extra={}){",`function nativeAction(action,extra={}){
  if(action==='startServices'){alert('Windows：请运行安装目录的 Start.cmd 恢复后台；不要重复启动已运行的实例。');return;}
  if(action==='openArchive'){alert('图片归档位于安装目录的 runtime/images，请在资源管理器中打开。');return;}
  if(action==='openQQ'){alert('请手动打开官方 QQ。同账号电脑 QQ 可能挤掉机器人会话。');return;}
`);
// No source runtime state, session logs, contacts, whitelist, credentials or chat history are copied.
const manifest=[];
async function inventory(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await inventory(path);else{const bytes=await readFile(path);manifest.push({path:path.slice(root.length+1).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex')});}}}
await inventory(root);await writeFile(join(root,'MANIFEST.json'),JSON.stringify({version:1,files:manifest},null,2));
const out=join(repo,'dist');await mkdir(out,{recursive:true});
const zip=join(out,`QQFriend-Windows-${version}.zip`);
execFileSync('/usr/bin/ditto',['-c','-k','--norsrc','--keepParent',root,zip]);
await writeFile(zip+'.sha256',createHash('sha256').update(await readFile(zip)).digest('hex')+`  QQFriend-Windows-${version}.zip\n`);
console.log(JSON.stringify({root,zip,files:manifest.length}));
