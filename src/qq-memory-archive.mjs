import {createHash} from 'node:crypto';

// Full, scoped evidence lives on disk. It never becomes a second unbounded
// prompt. Explicit forgetting also removes the corresponding archived sources.
export function openMemoryArchive(db,{terms,hasSecret,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS memory_archive(id TEXT PRIMARY KEY,scope TEXT NOT NULL,user TEXT NOT NULL,kind TEXT NOT NULL,parent TEXT,sourceId TEXT NOT NULL,content TEXT NOT NULL,reply TEXT NOT NULL,evidence TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS memory_archive_owner ON memory_archive(scope,user,at);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_archive_search USING fts5(id UNINDEXED,terms);
    CREATE TABLE IF NOT EXISTS memory_pins(id TEXT PRIMARY KEY,pinned INTEGER NOT NULL,at INTEGER NOT NULL);`);
  function append(row){
    if(!row.content||hasSecret(row.content)||hasSecret(row.reply)||hasSecret(row.evidence))return;
    const id=createHash('sha256').update(JSON.stringify([row.scope,row.user,row.kind,row.sourceId,row.content,row.reply||''])).digest('hex');
    const inserted=db.prepare('INSERT OR IGNORE INTO memory_archive VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,row.scope,row.user,row.kind,row.parent||null,row.sourceId,row.content,row.reply||'',row.evidence||row.content,row.at??now()).changes;
    if(inserted)db.prepare('INSERT INTO memory_archive_search VALUES(?,?)').run(id,terms(row.content+' '+(row.reply||'')).join(' '));
    return id;
  }
  // These are already-retained records in this same app, not a QQ crawl.
  for(const table of ['facts','turns']){
    let after='';
    for(;;){const batch=db.prepare(`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT 200`).all(after);if(!batch.length)break;
      for(const row of batch)append(table==='facts'?{...row,kind:'fact',parent:row.id}:{...row,kind:'exchange',sourceId:row.id,content:row.text,evidence:row.text});
      after=batch.at(-1).id;
    }
  }
  function list({scope,user},{query='',limit=25,offset=0}={}){
    limit=Math.max(1,Math.min(50,Number(limit)||25));offset=Math.max(0,Math.min(1000000,Number(offset)||0));
    const tokens=terms(query).slice(0,12);
    const rows=tokens.length?db.prepare('SELECT a.* FROM memory_archive_search JOIN memory_archive a ON a.id=memory_archive_search.id WHERE memory_archive_search MATCH ? AND a.scope=? AND a.user=? ORDER BY bm25(memory_archive_search),a.at DESC LIMIT ? OFFSET ?').all(tokens.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR '),scope,user,limit,offset)
      :db.prepare('SELECT * FROM memory_archive WHERE scope=? AND user=? ORDER BY at DESC,id LIMIT ? OFFSET ?').all(scope,user,limit,offset);
    return {entries:rows.map(row=>({...row,current:row.kind==='fact'?Boolean(db.prepare('SELECT 1 FROM facts WHERE id=? AND sourceId=? AND content=?').get(row.parent,row.sourceId,row.content)):null})),total:db.prepare('SELECT count(*) AS n FROM memory_archive WHERE scope=? AND user=?').get(scope,user).n};
  }
  function forget(owner,id){
    const rows=id==='all'?db.prepare('SELECT id FROM memory_archive WHERE scope=? AND user=?').all(owner.scope,owner.user)
      :db.prepare("SELECT id FROM memory_archive WHERE scope=? AND user=? AND (parent=? OR kind='exchange')").all(owner.scope,owner.user,id);
    for(const row of rows){db.prepare('DELETE FROM memory_archive_search WHERE id=?').run(row.id);db.prepare('DELETE FROM memory_archive WHERE id=?').run(row.id);}
    if(id==='all')db.prepare('DELETE FROM memory_pins WHERE id NOT IN (SELECT id FROM facts)').run();else db.prepare('DELETE FROM memory_pins WHERE id=?').run(id);
  }
  const pinned=id=>db.prepare('SELECT pinned FROM memory_pins WHERE id=?').get(id)?.pinned===1;
  function pin(owner,id,value){
    if(typeof value!=='boolean')throw Error('置顶开关必须是布尔值');
    if(!db.prepare('SELECT 1 FROM facts WHERE id=? AND scope=? AND user=?').get(id,owner.scope,owner.user))throw Error('记忆不属于当前会话和用户');
    db.prepare('INSERT OR REPLACE INTO memory_pins VALUES(?,?,?)').run(id,value?1:0,now());
  }
  return {append,list,forget,pinned,pin,count:()=>db.prepare('SELECT count(*) AS n FROM memory_archive').get().n};
}
