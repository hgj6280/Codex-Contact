import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const root=fileURLToPath(new URL('.',import.meta.url));
const arg=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--cli'))throw Error('--cli is required');
const configPath=process.argv.includes('--config')?resolve(arg('--config')):join(root,'config.example.json');
const config=JSON.parse(await readFile(configPath,'utf8'));
const digits=value=>/^\d{5,12}$/.test(String(value));
for(const key of ['allowedUsers','allowedGroups'])if(!Array.isArray(config[key])||!config[key].every(digits))throw Error(`Invalid ${key}`);
if(config.qqAccount&&!digits(config.qqAccount))throw Error('Invalid qqAccount');
if(!/^[a-zA-Z0-9._-]+$/.test(config.model)||!['low','medium','high'].includes(config.reasoningEffort))throw Error('Invalid model or effort');
const role=config.roleplay||{enabled:false,remaining:0};
if(role.enabled&&(!config.allowedGroups.includes(role.groupId)||!digits(role.targetId)||!Number.isInteger(role.remaining)||role.remaining<1||role.remaining>10))throw Error('Invalid roleplay config');
const state=join(root,'app/modules/qq-napcat/state');
await mkdir(join(state,'config'),{recursive:true});await mkdir(join(state,'qq'),{recursive:true});await mkdir(join(root,'runtime/logs'),{recursive:true});
async function createOnly(path,value){try{await writeFile(path,JSON.stringify(value,null,2),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}
await createOnly(join(state,'bridge.json'),{token:randomBytes(32).toString('hex'),allowedUsers:config.allowedUsers.map(String),allowedGroups:config.allowedGroups.map(String)});
const bridge=JSON.parse(await readFile(join(state,'bridge.json'),'utf8'));
await createOnly(join(state,'config/webui.json'),{host:'0.0.0.0',port:6099,prefix:'',token:randomBytes(32).toString('hex'),loginRate:3});
await createOnly(join(state,'config/onebot11.json'),{network:{httpServers:[],httpSseServers:[],httpClients:[],websocketClients:[],plugins:[],websocketServers:[{enable:true,name:'hub-bridge',host:'0.0.0.0',port:3001,messagePostFormat:'array',reportSelfMessage:false,enableForcePushEvent:true,token:bridge.token,debug:false,heartInterval:30000}]},musicSignUrl:'',enableLocalFile2Url:false,parseMultMsg:false});
await createOnly(join(root,'app/data/settings.json'),{version:1,channels:{qq:true,imessage:false},ai:{model:config.model,reasoningEffort:config.reasoningEffort},qq:{allowedGroups:bridge.allowedGroups,ownerUserIds:bridge.allowedUsers,enhancer:{enabled:false},proactive:{enabled:false}},branding:{assistantName:'狐宫静',assistantMentions:['@狐宫静','狐宫静']}});
await createOnly(join(root,'app/data/qq-roleplay.json'),role);
await createOnly(join(root,'launch.json'),{cli:resolve(arg('--cli'))});
try{await writeFile(join(root,'.env'),`QQ_ACCOUNT=${config.qqAccount||''}\n`,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
console.log('Configuration initialized; existing configuration and secrets preserved.');
