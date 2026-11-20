import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';

// Copy protocol settings, not Linux QQ databases. Those remain a rollback copy;
// the native QQ version creates its own platform-specific login/profile files.
const root=join(homedir(),'Library','Application Support','CodexRemoteContact');
const source=join(root,'napcat-state','config'),destination=join(homedir(),'Library','Containers','local.codexremotecontact.qq-engine','Data','Documents','NapCat','config');
await mkdir(destination,{recursive:true,mode:0o700});
for(const name of await readdir(source)) {
  if(!name.endsWith('.json'))continue;
  const config=JSON.parse(await readFile(join(source,name),'utf8'));
  if(name==='webui.json')config.host='127.0.0.1';
  for(const key of ['httpServers','httpSseServers','websocketServers'])
    for(const server of config.network?.[key]||[])server.host='127.0.0.1';
  if(name==='napcat.json'||/^napcat_\d+\.json$/.test(name)) {
    config.fileLogLevel='warn';
    config.consoleLogLevel='info';
  }
  await writeFile(join(destination,name),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log('Native QQ configuration prepared; credentials preserved; servers bound to loopback.');
