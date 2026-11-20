import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
if(process.argv[2]==='login'){
  const {token}=JSON.parse(await readFile(join(root,'app/modules/qq-napcat/state/config/webui.json'),'utf8'));
  // Secret is shown only to the local user, never sent to an agent or external service.
  console.log('Paste this local WebUI token into the login field: '+token);
  spawn('explorer.exe',['http://127.0.0.1:6099/webui/']);
}else if(process.argv[2]==='stop'){
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'stop.ps1')],{stdio:'inherit'});
  child.on('exit',code=>{process.exitCode=code;});
}else throw Error('Use login or stop');
