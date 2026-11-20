import {adminFetch} from './qq-admin-fetch.mjs';
// Local operator utility, never exposed to the agent or QQ senders.
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {openQqSendBudget} from '../src/qq-send-budget.mjs';
const root=join(homedir(),'Library','Application Support','CodexRemoteContact');
const reply=await adminFetch('http://127.0.0.1:3000/get_login_info',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
if(reply.status!=='ok'||!/^\d{5,13}$/.test(String(reply.data?.user_id)))throw Error('无法核对当前机器人账号，请先恢复QQ连接');
const account=String(reply.data.user_id),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),prefix=day.slice(5)+' ';
const log=join(root,'native-qq','native.log'),size=(await stat(log)).size;
let count=0;if(size)for await(const raw of createInterface({input:createReadStream(log,{end:size-1}),crlfDelay:Infinity})){
  const line=raw.replace(/\x1b\[[0-9;]*m/g,'');if(line.startsWith(prefix)&&line.includes('| 发送 ->'))count++;
}
if(!process.argv.includes('--apply'))console.log(JSON.stringify({account,day,count,logBytes:size,dryRun:true}));
else {const store=await openQqSendBudget(join(root,'data','qq-send-budget.sqlite'));try{console.log(JSON.stringify({account,day,count,logBytes:size,snapshot:store.seed(account,count)}));}finally{store.close();}}
