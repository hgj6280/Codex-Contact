import {mkdir,chmod,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createReverseProviders} from './qq-reverse-providers.mjs';
const run=promisify(execFile);
export function explicitImageSearch(text){return /(?:^\s*\/search(?:image)?(?:\s|$)|搜(?:一下)?图|找(?:一下)?出处|查(?:一下)?图源|原图出处)/i.test(String(text||'').replace(/\[CQ:[^\]]*\]/g,''));}
export function quotedImageInScope(event,rows=[]){
  const quote=event.replyContext;if(!quote)return false;
  if(event.groupId&&String(quote.raw?.group_id)===String(event.groupId))return true;
  if(!event.groupId&&quote.raw?.message_type==='private'&&String(quote.senderId)===String(event.senderId))return true;
  return rows.some(r=>String(r.messageId)===String(quote.messageId));
}
export function imageSearchMode(event,settings,{drawing=false}={}){
  if(!settings?.enabled||event.desktopDraft||event.proactiveDecision?.autonomous||!['group_message','group_at','private_message'].includes(event.type))return null;
  if(explicitImageSearch(event.text))return 'manual';
  if(!drawing&&event.groupId&&settings.autoGroups.includes(String(event.groupId))&&event.images?.length)return 'auto';
  return null;
}
export function formatSourceReply(result,{manual=false}={}){
  if(result.candidates?.length){const lines=['找到的来源候选（相似图不一定是首发）：'];for(const [i,c]of result.candidates.slice(0,3).entries()){
    lines.push(`${i+1}. ${c.engine==='saucenao'?'SauceNAO':'ascii2d'}${Number.isFinite(c.similarity)?` · 相似度 ${c.similarity.toFixed(2)}%`:''}`);
    if(c.publisher)lines.push('来源页署名：'+c.publisher);if(c.accountUrl)lines.push('公开账号：'+c.accountUrl);lines.push('原帖候选：'+c.postUrl);if(c.indexUrl)lines.push('索引页：'+c.indexUrl);
  }return lines.join('\n');}
  if(!manual)return null;
  const blocked=result.outcomes?.some(x=>['challenge','limited','cooldown'].includes(x.status));
  return [blocked?'暂时没找到可靠出处，部分免费服务需要验证或达到频率限制。':'暂时没找到可靠出处，没有把相似图当成原图。',result.lookupUrl?'Google Lens 备用结果页：\n'+result.lookupUrl:'可手动到 https://lens.google/ 或 https://tineye.com/ 上传查询。'].join('\n');
}
export async function normalizeSearchImage(bytes,{directory,execute=run}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length<10||bytes.length>20*1024*1024)throw Error('图片大小无效');
  const dir=await mkdtemp(join(directory,'lookup-temp-'));
  try{const input=join(dir,'input'),output=join(dir,'query.jpg');await writeFile(input,bytes,{mode:0o600});
    await execute('/opt/homebrew/bin/ffmpeg',['-v','error','-nostdin','-threads','1','-filter_threads','1','-i',input,'-map_metadata','-1','-an','-frames:v','1','-vf',"scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-q:v','3',output],{timeout:12000,maxBuffer:65536});const jpg=await readFile(output);if(jpg.length>4*1024*1024||jpg[0]!==255||jpg[1]!==216)throw Error('图片转换失败');return jpg;
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function openReverseSearch({directory,runtime,now=Date.now,providers,normalize,canSearch=()=>true,assertGroup=async()=>{}}={}){
  await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,'search.sqlite'),db=new DatabaseSync(path);await chmod(path,0o600);
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA cache_size=-512;
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cache(hash TEXT PRIMARY KEY,json TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS queries(id TEXT PRIMARY KEY,eventKey TEXT UNIQUE,scope TEXT,mode TEXT,at INTEGER,day TEXT,status TEXT,network INTEGER DEFAULT 0,json TEXT);
    CREATE TABLE IF NOT EXISTS engines(id TEXT PRIMARY KEY,until INTEGER NOT NULL,reason TEXT);`);
  let settings=JSON.parse(db.prepare('SELECT json FROM settings WHERE id=1').get()?.json||'{"enabled":true,"autoGroups":[],"dailyLimit":40,"cooldownSeconds":60,"revision":0}'),busy=false,closing=false,updatePending=Promise.resolve(),client=providers;
  const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now());
  const clone=x=>JSON.parse(JSON.stringify(x));
  const snapshot=()=>({...clone(settings),busy,requestsToday:db.prepare('SELECT count(*) n FROM queries WHERE day=? AND network=1').get(day()).n,providers:['SauceNAO（免密钥）','ascii2d（验证时暂停）','Google Lens（备用结果页）'],externalUpload:true});
  function update(input){const work=updatePending.catch(()=>{}).then(async()=>{if(input.revision!==settings.revision)throw Error('设置已变化，请重新读取');const next={...settings};if(typeof input.enabled!=='boolean'||!Array.isArray(input.autoGroups)||input.autoGroups.length>100||input.autoGroups.some(x=>!/^\d{5,15}$/.test(String(x))))throw Error('搜图开关或自动群号无效');next.enabled=input.enabled;next.autoGroups=[...new Set(input.autoGroups.map(String))];for(const group of next.autoGroups)await assertGroup(group);next.revision++;db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify(next));settings=next;return snapshot();});updatePending=work;return work;}
  function history(){return db.prepare('SELECT id,scope,mode,at,status,json FROM queries ORDER BY at DESC LIMIT 30').all().map(x=>({...x,...JSON.parse(x.json||'{}'),json:undefined}));}
  async function search(event,loadImage,{drawing=false}={}){
    const mode=imageSearchMode(event,settings,{drawing});if(!mode||closing||!canSearch(event))return null;event.imageSearch=true;
    const scope=event.groupId?String(event.groupId):'private:'+event.senderId,key=[event.selfId,scope,event.raw?.message_id||event.messageId||randomUUID()].join(':'),manual=mode==='manual';
    if(db.prepare('SELECT 1 FROM queries WHERE eventKey=?').get(key))return null;
    if(busy)return manual?'上一张图还在查询，稍等一下再搜。':null;
    const recent=db.prepare('SELECT at FROM queries WHERE scope=? AND mode=? ORDER BY at DESC LIMIT 1').get(scope,mode);
    if(recent&&now()-recent.at<(manual?5000:settings.cooldownSeconds*1000))return manual?'刚刚已经查过一张啦，稍等几秒再搜。':null;
    const id=randomUUID();db.prepare('INSERT INTO queries(id,eventKey,scope,mode,at,day,status,json) VALUES(?,?,?,?,?,?,?,?)').run(id,key,scope,mode,now(),day(),'preparing','{}');busy=true;
    const finish=(status,data={})=>{db.prepare('UPDATE queries SET status=?,json=? WHERE id=?').run(status,JSON.stringify(data),id);db.prepare('DELETE FROM queries WHERE id NOT IN (SELECT id FROM queries ORDER BY at DESC LIMIT 500)').run();};
    try{
      const bytes=await loadImage();if(!bytes){finish('no_image');return manual?'请附上图片，或引用那张图片说“搜图 / 找出处”。也可以在同一会话发图后5分钟内说“搜图”。':null;}
      if(!canSearch(event)||!imageSearchMode(event,settings,{drawing})){finish('cancelled');return null;}
      const hash=createHash('sha256').update(bytes).digest('hex'),cached=db.prepare('SELECT json FROM cache WHERE hash=? AND at>?').get(hash,now()-24*3600000);
      if(cached){const result=JSON.parse(cached.json);finish('cached',{result});return formatSourceReply(result,{manual});}
      if(snapshot().requestsToday>=settings.dailyLimit){finish('daily_limit');return manual?'今天的免费搜图保护额度已用完，明天再试，或手动使用 Lens。':null;}
      const jpg=await (normalize?normalize(bytes):normalizeSearchImage(bytes,{directory}));
      // Recheck after media preparation: an operator may have disabled the feature.
      if(!canSearch(event)||!imageSearchMode(event,settings,{drawing})){finish('cancelled');return null;}
      db.prepare('UPDATE queries SET network=1 WHERE id=?').run(id);client||=createReverseProviders({runtime});
      const result=await client.search(jpg,{allowed:()=>canSearch(event)&&!!imageSearchMode(event,settings,{drawing}),blocked:engine=>Number(db.prepare('SELECT until FROM engines WHERE id=?').get(engine)?.until||0)>now(),onProvider:(engine,r)=>{if(['challenge','limited'].includes(r.status))db.prepare('INSERT OR REPLACE INTO engines VALUES(?,?,?)').run(engine,now()+(r.status==='limited'?3600000:1800000),r.reason);}});
      if(result.candidates?.length){db.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run(hash,JSON.stringify(result),now());db.prepare('DELETE FROM cache WHERE hash NOT IN (SELECT hash FROM cache ORDER BY at DESC LIMIT 500)').run();}
      finish(result.candidates?.length?'matched':'no_match',{result});
      if(!canSearch(event)||!imageSearchMode(event,settings,{drawing}))return null;
      return formatSourceReply(result,{manual});
    }catch{finish('failed',{reason:'图片加载、转换或搜索服务暂时失败'});return manual?'这次图片加载或搜图服务暂时失败，没有找到可靠出处。请重新引用原图再试。':null;}
    finally{busy=false;}
  }
  return {snapshot,update,history,mode:(e,o)=>canSearch(e)?imageSearchMode(e,settings,o):null,search,async close(){closing=true;if(!busy){await client?.close();db.close();}}};
}
export async function handleReverseSearchRequest(req,res,{store,isLocalRequest,readBody,sendJson}){
  if(!req.url.startsWith('/api/qq/image-search/'))return false;
  if(!isLocalRequest(req)||req.headers['sec-fetch-site']==='cross-site'){sendJson(res,403,{error:'只允许本机管理页面'});return true;}
  const reply=(code,body)=>{sendJson(res,code,body);return true;};
  try{if(req.method==='GET'&&req.url==='/api/qq/image-search/settings')return reply(200,store.snapshot());if(req.method==='GET'&&req.url==='/api/qq/image-search/history')return reply(200,{events:store.history()});if(req.method==='POST'&&req.url==='/api/qq/image-search/settings')return reply(200,await store.update(await readBody(req)));return reply(404,{error:'接口不存在'});}catch(e){return reply(/设置已变化/.test(e.message)?409:400,{error:e.message});}
}
