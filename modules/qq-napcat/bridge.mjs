import {authorizeLoopback} from '../../src/qq-interface-auth.mjs';
import { createServer } from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {openNativeRecovery} from './native-recovery.mjs';
import {recoverQqLogin,qqBackendInfo} from './backend.mjs';
import { randomUUID } from 'node:crypto';
import {fileURLToPath} from 'node:url';
import { createConversationQueue } from './conversation-queue.mjs';
import {QQ_IMAGE_CONCURRENCY,QQ_IMAGE_QUEUE_LIMIT} from '../../src/qq-image-scheduler.mjs';
import {desktopKey,matchesDesktopKey,desktopReadActions,desktopWriteActions} from '../../src/qq-desktop-access.mjs';
import {openQqSendBudget} from '../../src/qq-send-budget.mjs';

const configPath = new URL('./state/bridge.json', import.meta.url);
const readConfig = async () => JSON.parse(await readFile(configPath, 'utf8'));
const desktopSecret=await desktopKey(fileURLToPath(new URL('./state/desktop.key',import.meta.url)));
const sendBudget=await openQqSendBudget(fileURLToPath(new URL('../../data/qq-send-budget.sqlite',import.meta.url)));
let directory={expires:0,groups:new Set(),users:new Set(),selfId:''},directoryPending;
async function refreshDirectory(force=false){
  if(!force&&Date.now()<directory.expires)return directory;
  if(directoryPending)return directoryPending;
  directoryPending=Promise.all([call('get_group_list'),call('get_friend_list'),call('get_login_info')]).then(([g,f,me])=>{
    if(g.status!=='ok'||f.status!=='ok'||me.status!=='ok'||!Array.isArray(g.data)||!Array.isArray(f.data))throw new Error('QQ directory unavailable');
    directory={expires:Date.now()+60000,groups:new Set(g.data.map(x=>String(x.group_id))),users:new Set(f.data.map(x=>String(x.user_id))),selfId:String(me.data.user_id)};return directory;
  }).finally(()=>{directoryPending=null;});return directoryPending;
}
const pending = new Map();
let socket;
let stopping = false;
const seen = new Map();
const stats = { received: 0, forwarded: 0, filtered: 0, failed: 0 };
const queue = createConversationQueue({ onError: () => { stats.failed++; } });
const imageQueue = createConversationQueue({concurrency:QQ_IMAGE_CONCURRENCY,limit:QQ_IMAGE_QUEUE_LIMIT,onError:()=>{stats.failed++;}});
const searchQueue=createConversationQueue({concurrency:1,limit:8,onError:()=>{stats.failed++;}});
const isAllowed = (items, id) => Array.isArray(items) && items.map(String).includes(String(id));

function call(action, params = {}, timeoutMs=20000) {
  if (socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('QQ connection unavailable'));
  return new Promise((resolve, reject) => {
    const echo = randomUUID();
    const timer = setTimeout(() => { pending.delete(echo); reject(new Error('QQ API timed out')); }, timeoutMs);
    pending.set(echo, { resolve:value=>{if(action==='get_status'&&value.status==='ok')nativeRecovery?.observe(value.data?.online);resolve(value);}, reject, timer });
    socket.send(JSON.stringify({ action, params, echo }));
  });
}
const execNative=promisify(execFile);
const nativeRecovery=await openNativeRecovery({
  path:fileURLToPath(new URL('../../data/qq-native-recovery.json',import.meta.url)),
  probe:async()=>{const r=await call('get_status',{},5000);return r.status==='ok'?r.data?.online:null;},
  isNative:async()=>JSON.parse(await readFile(new URL('./state/backend.json',import.meta.url),'utf8')).kind==='native',
  qrModifiedAt:async()=>(await stat(join(homedir(),'Library','Containers','local.codexremotecontact.qq-engine','Data','Documents','NapCat','cache','qrcode.png'))).mtimeMs,
  isIdle:()=>pending.size===0,
  restart:async()=>{const target=`gui/${process.getuid()}/local.codexremotecontact.qq-native`;await execNative('/bin/launchctl',['print',target],{timeout:5000});await execNative('/bin/launchctl',['kickstart','-k',target],{timeout:8000});}
});

async function handleEvent(event, {imageRequested=false,timing={}}={}) {
  if (event.post_type !== 'message' || !['private', 'group'].includes(event.message_type)) return;
  const config = await readConfig();
  const contacts=config.accessMode==='all-contacts'?await refreshDirectory():null;
  const allowed = contacts
    ? String(event.self_id)===contacts.selfId&&(event.message_type==='private'?contacts.users.has(String(event.user_id)):contacts.groups.has(String(event.group_id)))
    : event.message_type === 'private'?isAllowed(config.allowedUsers, event.user_id):isAllowed(config.allowedGroups, event.group_id);
  if (!allowed || String(event.user_id) === String(event.self_id)) { stats.filtered++; return; }
  if(!sendBudget.snapshot(event.self_id).canSend){stats.filtered++;return;}
  // Fail closed if the upstream cannot provide a stable message id.
  if (event.message_id == null) { stats.filtered++; return; }
  const key = `${event.self_id}:${event.message_type}:${event.group_id || event.user_id}:${event.message_id}`;
  const now = Date.now();
  for (const [k, expires] of seen) if (expires < now) seen.delete(k);
  if (seen.has(key)) return;
  seen.set(key, now + 600000);
  const response = await fetch('http://127.0.0.1:3789/api/onebot/event', {
    method: 'POST', redirect:'error', headers: { 'content-type': 'application/json','x-qq-desktop-key':desktopSecret,...timing }, body: JSON.stringify(event),
    // A full image job may include two edits plus independent visual checks.
    // Do not free its concurrency slot after the old 3-minute text timeout.
    signal: AbortSignal.timeout(imageRequested ? 45*60*1000 : 180000)
  });
  if (!response.ok) throw new Error(`Hub HTTP ${response.status}`);
  stats.forwarded++;
}

async function routeEvent(event,receivedAt){
  const timing={'x-qq-received-ms':String(receivedAt)};
  stats.received++;
  try{
    const config=await readConfig(),contacts=config.accessMode==='all-contacts'?await refreshDirectory():null;
    const allowed=contacts?String(event.self_id)===contacts.selfId&&(event.message_type==='private'?contacts.users.has(String(event.user_id)):contacts.groups.has(String(event.group_id)))
      :event.message_type==='private'?isAllowed(config.allowedUsers,event.user_id):isAllowed(config.allowedGroups,event.group_id);
    if(!allowed||event.message_id==null||String(event.user_id)===String(event.self_id)){stats.filtered++;return;}
    if(!sendBudget.snapshot(event.self_id).canSend){stats.filtered++;return;}
    const response=await fetch('http://127.0.0.1:3789/api/onebot/check',{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-qq-desktop-key':desktopSecret,...timing},body:JSON.stringify(event),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('QQ preflight unavailable');const decision=await response.json();if(!decision.respond){stats.filtered++;return;}
    if(decision.fast){await handleEvent(event,{timing});return;}
    const key=`${event.self_id}:${event.message_type}:${event.group_id||event.user_id}`;
    const targetQueue=decision.searchRequested?searchQueue:decision.imageRequested?imageQueue:queue;
    // Image jobs are independent requests even inside one group; quote/sender
    // routing is preserved in the original event. Text stays ordered per chat.
    const taskKey=decision.imageRequested?`${key}:image:${event.message_id}`:key;
    timing['x-qq-enqueued-ms']=String(Date.now());
    if(!targetQueue.add(taskKey,()=>handleEvent(event,{imageRequested:decision.imageRequested===true,timing})))stats.filtered++;
  }catch{stats.failed++;}
}

async function connect() {
  const config = await readConfig();
  socket = new WebSocket(`ws://127.0.0.1:3001?access_token=${encodeURIComponent(config.token)}`);
  socket.addEventListener('open', () => {directory.expires=0;refreshDirectory().catch(()=>{});console.log('QQ OneBot connected');});
  socket.addEventListener('message', ({ data }) => {
    const receivedAt=Date.now();
    let message;
    try { message = JSON.parse(data); } catch { return; }
    const request = pending.get(message.echo);
    if (request) {
      clearTimeout(request.timer); pending.delete(message.echo); request.resolve(message); return;
    }
    if (message.post_type==='notice')directory.expires=0;
    if(['message','message_sent'].includes(message.post_type)&&String(message.user_id)===String(message.self_id)||message.post_type==='message_sent')try{sendBudget.observe(message);}catch{}
    if (message.post_type==='request'||(['message', 'message_sent'].includes(message.post_type) && ['group','private'].includes(message.message_type))) {
      // Feed the chat panel independently of model queues and automatic replies.
      refreshDirectory().then(async contacts => {
        const target=String(message.user_id)===String(message.self_id)?message.target_id:message.user_id;
        if(String(message.self_id)!==contacts.selfId)return;
        if(message.post_type!=='request'&&!(message.message_type==='group'?contacts.groups.has(String(message.group_id)):contacts.users.has(String(target))))return;
        const response = await fetch('http://127.0.0.1:3789/api/qq/chat/incoming', {
          method: 'POST', redirect:'error', headers: { 'content-type': 'application/json','x-qq-desktop-key':desktopSecret }, body: JSON.stringify(message), signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) console.warn('Chat panel record failed:', response.status);
      }).catch(() => {});
    }
    if (message.post_type !== 'message' || !['private', 'group'].includes(message.message_type)) return;
    routeEvent(message,receivedAt);
  });
  socket.addEventListener('error', () => {});
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer); request.reject(new Error('QQ disconnected'));
    }
    pending.clear();
    if (!stopping) setTimeout(() => connect().catch(() => process.exit(1)), 5000);
  });
}

const actions = new Set(['get_login_info', 'get_status', 'get_image', 'get_msg', 'get_forward_msg',
  'get_group_list', 'send_group_msg', 'send_private_msg']);
const server = createServer(async (req, res) => {
  if (!authorizeLoopback(req, res, {port:3000, key:desktopSecret})) return;
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.headers.origin || !['127.0.0.1:3000', 'localhost:3000'].includes(req.headers.host))
      return json(403, { status: 'failed', message: 'Local service requests only' });
    if (req.method === 'GET' && req.url === '/health')
      return json(200, { connected: socket?.readyState === WebSocket.OPEN, qqOnline:nativeRecovery.snapshot().online,nativeRecovery:nativeRecovery.snapshot(), ...stats, sendBudget:directory.selfId?sendBudget.snapshot(directory.selfId):null,queued: queue.size+imageQueue.size+searchQueue.size, active: queue.active+imageQueue.active+searchQueue.active,
        backend:qqBackendInfo(JSON.parse(await readFile(new URL('./state/backend.json',import.meta.url),'utf8'))),
        searches:{active:searchQueue.active,queued:searchQueue.size-searchQueue.active},text:{active:queue.active,queued:queue.size-queue.active},images:{active:imageQueue.active,queued:imageQueue.size-imageQueue.active,concurrency:QQ_IMAGE_CONCURRENCY} });
    const manual=req.url.startsWith('/desktop/'),action=manual?req.url.slice(9):req.url.slice(1);
    if(manual&&!matchesDesktopKey(req.headers['x-qq-desktop-key'],desktopSecret))return json(403,{status:'failed',message:'Desktop authorization required'});
    if(manual&&action==='recover_login'){
      if(req.method!=='POST')return json(405,{status:'failed'});
      return json(200,{status:'ok',retcode:0,data:await recoverQqLogin({exec:execNative,recovery:nativeRecovery})});
    }
    if(manual&&['get_send_budget','set_send_budget'].includes(action)){
      if(action==='set_send_budget'?req.method!=='POST':!['GET','POST'].includes(req.method))return json(405,{status:'failed',message:'Unsupported method'});
      const contacts=await refreshDirectory();let input='';for await(const chunk of req){input+=chunk;if(Buffer.byteLength(input)>2048)return json(413,{status:'failed'});}
      const data=action==='set_send_budget'?sendBudget.update(contacts.selfId,JSON.parse(input)):sendBudget.snapshot(contacts.selfId);return json(200,{status:'ok',retcode:0,data});
    }
    if (!(manual?(desktopReadActions.has(action)||desktopWriteActions.has(action)):actions.has(action)) || !['GET', 'POST'].includes(req.method)) return json(404, { status: 'failed' });
    if(manual&&desktopWriteActions.has(action)&&req.method!=='POST')return json(405,{status:'failed'});
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 24 * 1024 * 1024) return json(413, { status: 'failed' });
    }
    const params = body ? JSON.parse(body) : {};
    const config = await readConfig();
    if(nativeRecovery.snapshot().online===false&&['send_group_msg','send_private_msg','get_image','get_msg','get_forward_msg','get_group_file_url','get_private_file_url'].includes(action))return json(200,{status:'failed',retcode:1503,code:'QQ_OFFLINE',message:'QQ已离线，正在恢复登录；请稍后重试'});
    if(manual){
      const contacts=await refreshDirectory(desktopWriteActions.has(action));
      if(params.group_id&&!contacts.groups.has(String(params.group_id)))return json(403,{status:'failed',message:'Not joined to this group'});
      if(action==='send_private_msg'&&!contacts.users.has(String(params.user_id)))return json(403,{status:'failed',message:'Not a QQ friend'});
    } else if (action.startsWith('send_')) {
      const contacts=config.accessMode==='all-contacts'?await refreshDirectory(true):null;
      const allowed = contacts?(action==='send_group_msg'?contacts.groups.has(String(params.group_id)):contacts.users.has(String(params.user_id)))
        : action === 'send_group_msg'?isAllowed(config.allowedGroups, params.group_id):isAllowed(config.allowedUsers, params.user_id);
      if (req.method !== 'POST' || !allowed) return json(403, { status: 'failed', message: 'Recipient not allowed' });
    }
    let reservation;
    if(['send_group_msg','send_private_msg'].includes(action)){
      const account=(await refreshDirectory()).selfId;
      try{reservation=sendBudget.reserve(account);}catch(error){return json(200,{status:'failed',retcode:1429,message:error.message,code:error.code});}
    }
    let result;try{result=await call(action, params);if(reservation)sendBudget.finish(reservation,result);}catch(error){if(reservation)sendBudget.finish(reservation,null);throw error;}
    if (!manual&&config.accessMode!=='all-contacts'&&action === 'get_group_list' && Array.isArray(result.data)) {
      result.data = result.data.filter(group => isAllowed(config.allowedGroups, group.group_id));
    }
    json(200, result);
  } catch { json(503, { status: 'failed', retcode: 1503, message: 'QQ bridge unavailable or request invalid' }); }
});
server.listen(3000, '127.0.0.1', () => console.log('QQ bridge listening at 127.0.0.1:3000'));
await connect();
const recoveryTimer=setInterval(()=>nativeRecovery.tick(),30000);recoveryTimer.unref();
nativeRecovery.tick();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopping = true;clearInterval(recoveryTimer); socket?.close(); server.close(); setTimeout(() => process.exit(0), 1000).unref();
});
