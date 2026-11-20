import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const sections = ['names', 'requests', 'media'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const empty = () => ({version:1, groups:{}, names:{}, requests:{}, seeded:false, revision:0, media:{}});
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

function publish(temp, target) {
  renameSync(temp, target);
  if (process.platform === 'win32') return;
  const fd = openSync(dirname(target), 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function atomicFile(path, bytes, mode = 0o600) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, bytes, {flag:'wx', mode, flush:true});
    publish(temp, path);
  } finally { rmSync(temp, {force:true}); }
}

// The per-conversation index retains the exact order, including timestamp ties,
// legacy rows without IDs, and the desktop's existing 300-message window.
class Rows {
  constructor(db) {
    this.db = db;
    this.ids = new WeakMap();
    this.sql = new Map();
  }
  stmt(sql) {
    if (!this.sql.has(sql)) this.sql.set(sql, this.db.prepare(sql));
    return this.sql.get(sql);
  }
  set(section, key, value) {
    if (value === undefined) this.stmt('DELETE FROM fields WHERE section=? AND key=?').run(section,key);
    else this.stmt('INSERT INTO fields VALUES(?,?,?) ON CONFLICT(section,key) DO UPDATE SET body=excluded.body').run(section,key,JSON.stringify(value));
  }
  get(section,key) {
    const row=this.stmt('SELECT body FROM fields WHERE section=? AND key=?').get(section,key);
    return row && JSON.parse(row.body);
  }
  group(key, previous, next) {
    const retained=new Set(next);
    for(const item of previous) if(!retained.has(item)) this.stmt('DELETE FROM messages WHERE n=?').run(this.ids.get(item));
    const ids=next.map(item=>{
      if(!this.ids.has(item)) this.ids.set(item,Number(this.stmt('INSERT INTO messages(body) VALUES(?)').run(JSON.stringify(item)).lastInsertRowid));
      return this.ids.get(item);
    });
    this.stmt('INSERT INTO conversations VALUES(?,?) ON CONFLICT(key) DO UPDATE SET ids=excluded.ids').run(key,JSON.stringify(ids));
  }
  load(includeMedia=false) {
    const data=empty();
    for(const {section,key,body} of this.stmt("SELECT * FROM fields WHERE (? OR section!='media') ORDER BY rowid").iterate(Number(includeMedia))){
      if(section==='meta') data[key]=JSON.parse(body);
      else data[section][key]=JSON.parse(body);
    }
    const groupRows=this.stmt('SELECT m.n,m.body FROM json_each(?) i JOIN messages m ON m.n=i.value ORDER BY i.key');
    for(const {key,ids} of this.stmt('SELECT * FROM conversations').iterate()){
      const entries=[];
      for(const {n,body} of groupRows.iterate(ids)){
        const item=JSON.parse(body); this.ids.set(item,n);entries.push(item);
      }
      if(entries.length!==JSON.parse(ids).length)throw Error('聊天记录索引不完整');
      data.groups[key]=entries;
    }
    return data;
  }
}
function top100(groups) {
  return Object.keys(groups).sort().flatMap(key=>groups[key].map(item=>[key,item]))
    .sort((a,b)=>String(b[1].at??'').localeCompare(String(a[1].at??''))).slice(0,100);
}
function checkMigration(source,rows) {
  const actual=rows.load();
  const count=groups=>Object.values(groups).reduce((n,g)=>n+g.length,0);
  const before=count(source.groups),after=count(actual.groups);
  const recent=top100(source.groups);
  if(before!==after || !isDeepStrictEqual(recent,top100(actual.groups)) ||
    !isDeepStrictEqual({...source,media:{}},actual))throw Error('迁移校验失败：会话、消息内容、顺序或附属状态不一致');
  let mediaCount=0;
  for(const {key,body} of rows.stmt("SELECT key,body FROM fields WHERE section='media'").iterate()){
    if(!isDeepStrictEqual(source.media[key],JSON.parse(body)))throw Error('图片索引校验失败');
    mediaCount++;
  }
  if(mediaCount!==Object.keys(source.media).length)throw Error('图片索引数量不一致');
  return {before,after,recentCompared:recent.length,allRowsEqual:true,mediaCount};
}
function migrate(directory,original,file) {
  let data=empty(),backup=null,sha256=null;
  if(existsSync(original)){
    const raw=readFileSync(original);
    sha256=digest(raw); backup='messages.before-sqlite-'+sha256+'.json';
    const dest=join(directory,backup);
    if(!existsSync(dest))atomicFile(dest,raw,0o400);
    if(digest(readFileSync(dest))!==sha256)throw Error('原记录备份校验失败');
    chmodSync(dest,0o400);
    const parsed=JSON.parse(raw);
    if(!parsed.groups || typeof parsed.groups!=='object'||Array.isArray(parsed.groups))throw Error('聊天记录格式无效');
    data={...data,...parsed};
  }
  const temp=file+'.'+randomUUID()+'.tmp';
  let db;
  try {
    writeFileSync(temp,'',{mode:0o600,flag:'wx'});
    db=new DatabaseSync(temp);
    db.exec(`PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
      CREATE TABLE messages(n INTEGER PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE conversations(key TEXT PRIMARY KEY,ids TEXT NOT NULL);
      CREATE TABLE fields(section TEXT NOT NULL,key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(section,key));
      CREATE TABLE migration(report TEXT NOT NULL);`);
    const rows=new Rows(db);
    for(const [key,entries] of Object.entries(data.groups))rows.group(key,[],entries);
    for(const section of sections)for(const [k,v] of Object.entries(data[section]))rows.set(section,k,v);
    for(const [k,v] of Object.entries(data))if(k!=='groups'&&!sections.includes(k))rows.set('meta',k,v);
    const report={...checkMigration(data,rows),backup,sha256,at:new Date().toISOString()};
    db.prepare('INSERT INTO migration VALUES(?)').run(JSON.stringify(report));
    db.exec('COMMIT');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite 完整性检查失败');
    db.close();db=null;
    if(backup&&digest(readFileSync(original))!==sha256)throw Error('迁移期间原记录有更新，已取消切换');
    publish(temp,file);
  } finally { db?.close();rmSync(temp,{force:true}); }
}

export function openChatStorage(directory) {
  const original=join(directory,'messages.json'), file=join(directory,'messages.sqlite');
  const fallback=join(directory,'messages.rollback.json');
  let db,rows,data;
  if(existsSync(fallback))data={...empty(),...readJson(fallback)};
  else {
    if(!existsSync(file))migrate(directory,original,file);
    db=new DatabaseSync(file);
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if(!db.prepare('SELECT report FROM migration').get())throw Error('缺少已校验的迁移记录');
      if(existsSync(original))chmodSync(original,0o400);
      rows=new Rows(db); data=rows.load();
    } catch(error){db.close();throw error;}
  }
  function set(section,key,value) {
    rows?.set(section,key,value);
    if(rows && section==='media')return;
    const target=section==='meta'?data:data[section];
    if(value===undefined)delete target[key];else target[key]=value;
  }
  return {
    get data(){return data;},
    mode:()=>db?'sqlite':'json',
    set,
    image:key=>rows?rows.get('media',key):data.media[key],
    group(key,entries){
      rows?.group(key,data.groups[key]||[],entries);
      data.groups[key]=entries;
    },
    write(work) {
      db?.exec('BEGIN IMMEDIATE');
      try{
        const result=work();
        if(db)db.exec('COMMIT');else atomicFile(fallback,JSON.stringify(data));
        return result;
      } catch(error){
        if(db?.isTransaction)db.exec('ROLLBACK');
        data=rows?rows.load():readJson(fallback);
        throw error;
      }
    },
    rollback(){
      if(!db)return {mode:'json'};
      const snapshot=rows.load(true);
      // Publish only after re-reading the complete exported snapshot.
      const temp=fallback+'.'+randomUUID()+'.tmp';
      try{
        writeFileSync(temp,JSON.stringify(snapshot),{mode:0o600,flush:true,flag:'wx'});
        if(!isDeepStrictEqual(readJson(temp),snapshot))throw Error('回滚记录校验失败');
        publish(temp,fallback);
      } finally {rmSync(temp,{force:true});}
      data=snapshot;rows=null;
      db.close();db=null;
      return {mode:'json',messages:Object.values(data.groups).reduce((n,g)=>n+g.length,0)};
    }
  };
}

// Used only by the offline recovery command with the Hub stopped. A damaged
// published database must surface an error rather than discard later messages.
export function rollbackStoppedChat(directory) {
  if(existsSync(join(directory,'messages.sqlite')) || existsSync(join(directory,'messages.rollback.json'))) {
    return openChatStorage(directory).rollback();
  }
  const source=join(directory,'messages.json');
  const raw=readFileSync(source);
  const parsed=JSON.parse(raw);
  if(!parsed.groups || typeof parsed.groups !== 'object')throw Error('原记录格式无效');
  atomicFile(join(directory,'messages.rollback.json'),raw);
  chmodSync(source,0o400);
  return {mode:'json',messages:Object.values(parsed.groups).reduce((n,g)=>n+g.length,0)};
}
