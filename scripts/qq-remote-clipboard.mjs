import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const CLIPBOARD_LIMIT=65536;
// On demand only. Text travels over stdin, never shell syntax, argv, a model,
// an HTTP endpoint or a log. Only the bot's fixed container/display is allowed.
export async function transferClipboard(operation,text='',{read=readFile,run=runXclip,home=homedir()}={}){
  if(!['get','set'].includes(operation))throw Error('剪贴板操作无效');
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>CLIPBOARD_LIMIT||text.includes('\0'))throw Error('仅支持不超过64KB的纯文字');
  const config=JSON.parse(await read(join(home,'Library/Application Support/CodexRemoteContact/napcat-state/backend.json'),'utf8'));
  if(config.kind!=='snowluma'||config.profile!=='qq-contact')throw Error('当前未使用 SnowLuma 远程桌面');
  const args=['--context','colima-qq-contact','exec','-u','501:20','-e','DISPLAY=:1',...(operation==='set'?['-i']:[]),
    'codex-contact-snowluma','/app/data/desktop-input/bin/xclip','-selection','clipboard',operation==='set'?'-in':'-out','-target','UTF8_STRING'];
  const output=await run('/opt/homebrew/bin/docker',args,operation==='set'?text:undefined);
  if(operation==='get'&&Buffer.byteLength(output,'utf8')>CLIPBOARD_LIMIT)throw Error('远端文字超过64KB，未替换 Mac 剪贴板');
  return operation==='get'?{ok:true,text:output}:{ok:true};
}
function runXclip(file,args,input){
  return new Promise((resolve,reject)=>{
    const p=spawn(file,args,{stdio:['pipe','pipe','pipe']});let output=[],length=0,settled=false;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(Buffer.concat(output).toString('utf8'));};
    const timer=setTimeout(()=>{p.kill('SIGKILL');finish(Error('远端剪贴板没有响应，请确认 QQ 远程桌面已启动'));},6000);
    p.stdout.on('data',bytes=>{length+=bytes.length;if(length>CLIPBOARD_LIMIT){p.kill('SIGKILL');finish(Error('远端剪贴板文字超过64KB'));}else output.push(bytes);});
    p.stderr.resume();p.on('error',()=>finish(Error('无法连接本机 Docker 剪贴板工具')));
    p.on('close',code=>finish(code===0?null:Error('远端没有可复制的文字，或剪贴板尚未准备好')));
    p.stdin.on('error',()=>{});p.stdin.end(input===undefined?undefined:Buffer.from(input,'utf8'));
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>CLIPBOARD_LIMIT)throw Error('文字超过64KB');chunks.push(chunk);}
    process.stdout.write(JSON.stringify(await transferClipboard(process.argv[2],Buffer.concat(chunks).toString('utf8'))));
  }catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
