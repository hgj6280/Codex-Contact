import {createHash} from 'node:crypto';

const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export const QQ_SOCIAL_POLICY={minIdleMs:30*60000,maxIdleMs:90*60000,privatePerDay:3,groupPerDay:2,privateCooldownMs:3*3600000,groupCooldownMs:2*3600000,maxDailyDecisions:10,minDecisionGapMs:10*60000};
export function openCompanionDiary(db,{now=Date.now,terms,hasSecret}){
  db.exec(`CREATE TABLE IF NOT EXISTS diary_entries(id TEXT PRIMARY KEY,scope TEXT NOT NULL,user TEXT NOT NULL,day TEXT NOT NULL,subject TEXT NOT NULL,content TEXT NOT NULL,evidence TEXT NOT NULL,sourceId TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS diary_owner ON diary_entries(scope,user,at);
    CREATE VIRTUAL TABLE IF NOT EXISTS diary_search USING fts5(id UNINDEXED,terms);
    CREATE TABLE IF NOT EXISTS diary_followups(id TEXT PRIMARY KEY,scope TEXT NOT NULL,user TEXT NOT NULL,sourceId TEXT NOT NULL,sourceAt INTEGER NOT NULL,topic TEXT NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL,attemptAt INTEGER,reason TEXT);
    CREATE INDEX IF NOT EXISTS diary_due ON diary_followups(status,due);`);
  if(!db.prepare('PRAGMA table_info(diary_followups)').all().some(c=>c.name==='kind'))db.exec("ALTER TABLE diary_followups ADD COLUMN kind TEXT NOT NULL DEFAULT 'unfinished'");
  if(!db.prepare('PRAGMA table_info(diary_followups)').all().some(c=>c.name==='purposeId'))db.exec('ALTER TABLE diary_followups ADD COLUMN purposeId TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS companion_purposes(id TEXT PRIMARY KEY,scope TEXT NOT NULL,user TEXT NOT NULL,kind TEXT NOT NULL,topic TEXT NOT NULL,nextStep TEXT NOT NULL,evidence TEXT NOT NULL,sourceId TEXT NOT NULL,at INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT);
    CREATE INDEX IF NOT EXISTS companion_purpose_owner ON companion_purposes(scope,user,at);`);
  // A send interrupted by restart has an uncertain native outcome. Never replay it.
  db.prepare("UPDATE diary_followups SET status='unknown',reason='服务重启，未重复发送' WHERE status='sending'").run();
  function removeRows(rows){for(const r of rows){db.prepare('DELETE FROM diary_search WHERE id=?').run(r.id);db.prepare('DELETE FROM diary_entries WHERE id=?').run(r.id);}}
  function forget({scope,user}){
    removeRows(db.prepare('SELECT id FROM diary_entries WHERE scope=? AND user=?').all(scope,user));
    db.prepare('DELETE FROM diary_followups WHERE scope=? AND user=?').run(scope,user);
    db.prepare('DELETE FROM companion_purposes WHERE scope=? AND user=?').run(scope,user);
  }
  function invalidate({scope,user,subject}){
    removeRows(db.prepare('SELECT id FROM diary_entries WHERE scope=? AND user=? AND subject=?').all(scope,user,subject));
    db.prepare("UPDATE diary_followups SET status='cancelled',reason='记忆已更正' WHERE scope=? AND user=? AND status IN ('pending','sending')").run(scope,user);
    db.prepare("UPDATE companion_purposes SET status='cancelled',reason='相关记忆已更正' WHERE scope=? AND user=? AND status='pending'").run(scope,user);
  }
  function append(owner,fact){
    const day=date.format(new Date(fact.at));
    const id=createHash('sha256').update(owner.scope+'|'+owner.user+'|'+day+'|'+fact.subject).digest('hex');
    db.prepare('INSERT OR REPLACE INTO diary_entries VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner.scope,owner.user,day,fact.subject,fact.content,fact.evidence,fact.sourceId,fact.at);
    db.prepare('DELETE FROM diary_search WHERE id=?').run(id);
    db.prepare('INSERT INTO diary_search VALUES(?,?)').run(id,terms(fact.content).join(' '));
    // Bound each person's daily digest, not original QQ history or existing facts.
    removeRows(db.prepare('SELECT id FROM diary_entries WHERE scope=? AND user=? AND day=? ORDER BY at DESC LIMIT -1 OFFSET 12').all(owner.scope,owner.user,day));
  }
  function list({scope,user},{query='',limit=3}={}){
    const tokens=terms(query).slice(0,12);let rows;
    if(tokens.length){const match=tokens.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR ');
      rows=db.prepare('SELECT d.* FROM diary_search JOIN diary_entries d ON d.id=diary_search.id WHERE diary_search MATCH ? AND scope=? AND user=? ORDER BY bm25(diary_search),at DESC LIMIT 12').all(match,scope,user);
    }else rows=db.prepare('SELECT * FROM diary_entries WHERE scope=? AND user=? ORDER BY at DESC LIMIT 12').all(scope,user);
    const result=[];let used=0;
    for(const row of rows){if(result.length>=Math.min(6,limit)||used+row.content.length>650)break;used+=row.content.length;result.push(row);}
    return result;
  }
  function plan(owner,proposal,rows){
    if(!proposal||typeof proposal.confidence!=='number'||!Number.isFinite(proposal.confidence)||proposal.confidence<.95||proposal.confidence>1||typeof proposal.topic!=='string'||proposal.topic.length>120||!proposal.topic.trim()||hasSecret(proposal.topic))return;
    const source=rows.at(-1);
    if(!source||source.processed!==0||source.id!==proposal.sourceId||typeof proposal.evidence!=='string'||proposal.evidence.length<4||!source.text.includes(proposal.evidence)||now()-source.at>86400000)return;
    // One open thread per person; current chat arrival invalidates old threads.
    db.prepare("UPDATE diary_followups SET status='cancelled',reason='被更新的话题替代' WHERE scope=? AND user=? AND id<>? AND status='pending'").run(owner.scope,owner.user,source.id);
    const jitter=parseInt(source.id.slice(0,8),16)%(QQ_SOCIAL_POLICY.maxIdleMs-QQ_SOCIAL_POLICY.minIdleMs);
    db.prepare("INSERT INTO diary_followups(id,scope,user,sourceId,sourceAt,topic,due,status,kind) VALUES(?,?,?,?,?,?,?,'pending','unfinished') ON CONFLICT(id) DO UPDATE SET topic=excluded.topic,kind='unfinished' WHERE diary_followups.status='pending'").run(source.id,owner.scope,owner.user,source.id,source.at,proposal.topic,source.at+QQ_SOCIAL_POLICY.minIdleMs+jitter);
  }
  function planSocial(owner,source){
    if(!source||source.processed===2||!source.reply||now()-source.at>7*86400000||source.at>now()||hasSecret(source.text))return false;
    // A real delivered exchange supplies provenance. The model later decides
    // whether to speak; this does not label the person's words as an open task.
    if(db.prepare('SELECT 1 FROM diary_followups WHERE id=?').get(source.id))return false;
    db.prepare("UPDATE diary_followups SET status='cancelled',reason='以最新真实互动为准' WHERE scope=? AND status='pending'").run(owner.scope);
    const jitter=parseInt(source.id.slice(0,8),16)%(QQ_SOCIAL_POLICY.maxIdleMs-QQ_SOCIAL_POLICY.minIdleMs);
    return db.prepare("INSERT OR IGNORE INTO diary_followups(id,scope,user,sourceId,sourceAt,topic,due,status,kind) VALUES(?,?,?,?,?,?,?,'pending','social')")
      .run(source.id,owner.scope,owner.user,source.id,source.at,source.text.slice(0,160),Math.max(now()+QQ_SOCIAL_POLICY.minIdleMs,source.at+QQ_SOCIAL_POLICY.minIdleMs+jitter)).changes===1;
  }
  function incoming({scope},sourceAt){
    db.prepare("UPDATE diary_followups SET status='cancelled',reason='会话已有新消息，交给正常聊天承接' WHERE scope=? AND sourceAt<? AND status IN ('pending','sending')").run(scope,sourceAt);
  }
  function due(){
    const time=now();db.prepare("UPDATE diary_followups SET status='expired',reason='话题已过期' WHERE status='pending' AND ((kind='unfinished' AND sourceAt<?) OR (kind IN ('social','purpose') AND sourceAt<?))").run(time-86400000,time-7*86400000);
    db.prepare("UPDATE companion_purposes SET status='expired' WHERE status='pending' AND at<?").run(time-7*86400000);
    return db.prepare("SELECT * FROM diary_followups WHERE status='pending' AND due<=? ORDER BY CASE WHEN scope LIKE 'private:%' THEN 0 ELSE 1 END,due LIMIT 64").all(time);
  }
  function current(row){return db.prepare('SELECT status FROM diary_followups WHERE id=?').get(row.id)?.status==='sending';}
  function claim(row){
    const since=now()-86400000;
    const attempts=db.prepare('SELECT scope,attemptAt FROM diary_followups WHERE attemptAt>=?').all(since),same=attempts.filter(r=>r.scope===row.scope),privateChat=row.scope.startsWith('private:');
    if(attempts.length>=QQ_SOCIAL_POLICY.maxDailyDecisions||attempts.some(r=>now()-r.attemptAt<QQ_SOCIAL_POLICY.minDecisionGapMs)||same.length>=(privateChat?QQ_SOCIAL_POLICY.privatePerDay:QQ_SOCIAL_POLICY.groupPerDay)||same.some(r=>now()-r.attemptAt<(privateChat?QQ_SOCIAL_POLICY.privateCooldownMs:QQ_SOCIAL_POLICY.groupCooldownMs)))return false;
    return db.prepare("UPDATE diary_followups SET status='sending',attemptAt=? WHERE id=? AND status='pending'").run(now(),row.id).changes===1;
  }
  function finish(row,status,reason){
    db.prepare("UPDATE diary_followups SET status=?,reason=? WHERE id=? AND status='sending'").run(status,String(reason||'').slice(0,160),row.id);
    if(row.purposeId)db.prepare("UPDATE companion_purposes SET status=?,reason=? WHERE id=? AND status='pending'").run(status==='sent'?'shared':status,String(reason||'').slice(0,160),row.purposeId);
  }
  function purposes({scope,user}){return db.prepare('SELECT * FROM companion_purposes WHERE scope=? AND user=? ORDER BY at DESC LIMIT 12').all(scope,user);}
  function planPurpose(owner,proposal,rows){
    if(!proposal||!['share','curiosity','invite','care','create','follow'].includes(proposal.kind)||typeof proposal.confidence!=='number'||!Number.isFinite(proposal.confidence)||proposal.confidence<.95||proposal.confidence>1)return false;
    const source=rows.find(r=>r.id===proposal.sourceId&&r.processed===0);
    if(!source||now()-source.at>86400000||typeof proposal.evidence!=='string'||proposal.evidence.length<4||!source.text.includes(proposal.evidence))return false;
    if(![proposal.topic,proposal.nextStep].every(s=>typeof s==='string'&&s.trim()&&s.length<=120&&!hasSecret(s)))return false;
    const id=createHash('sha256').update(owner.scope+'|'+owner.user+'|'+proposal.kind+'|'+proposal.topic).digest('hex');
    const old=db.prepare('SELECT * FROM companion_purposes WHERE id=?').get(id);
    if(old&&old.sourceId===source.id)return false;
    db.prepare("INSERT INTO companion_purposes VALUES(?,?,?,?,?,?,?,?,?,'pending',NULL) ON CONFLICT(id) DO UPDATE SET nextStep=excluded.nextStep,evidence=excluded.evidence,sourceId=excluded.sourceId,at=excluded.at,status='pending',reason=NULL")
      .run(id,owner.scope,owner.user,proposal.kind,proposal.topic,proposal.nextStep,proposal.evidence,source.id,source.at);
    const topic=db.prepare('SELECT * FROM diary_followups WHERE id=?').get(source.id);
    if(!topic)planSocial(owner,source);
    db.prepare("UPDATE diary_followups SET topic=?,kind='purpose',purposeId=? WHERE id=? AND status='pending' AND kind<>'unfinished'").run(proposal.topic,id,source.id);
    return true;
  }
  function updatePurposes(owner,updates,rows){
    for(const u of Array.isArray(updates)?updates.slice(0,2):[]){
      const source=rows.find(r=>r.id===u.sourceId&&r.processed===0);
      if(!source||!['completed','dismissed'].includes(u.status)||typeof u.evidence!=='string'||u.evidence.length<4||!source.text.includes(u.evidence))continue;
      const changed=db.prepare("UPDATE companion_purposes SET status=?,reason=? WHERE id=? AND scope=? AND user=? AND status IN ('pending','shared')").run(u.status,u.evidence.slice(0,160),u.id,owner.scope,owner.user).changes;
      if(changed)db.prepare("UPDATE diary_followups SET status='cancelled',reason='话题已完成或对方不希望继续' WHERE purposeId=? AND status='pending'").run(u.id);
    }
  }
  function purposeFor(row){return row.purposeId?db.prepare('SELECT * FROM companion_purposes WHERE id=? AND scope=? AND user=?').get(row.purposeId,row.scope,row.user):null;}
  const snapshot=()=>({socialPolicy:{...QQ_SOCIAL_POLICY},diaryEntries:db.prepare('SELECT count(*) AS n FROM diary_entries').get().n,pendingFollowups:db.prepare("SELECT count(*) AS n FROM diary_followups WHERE status='pending'").get().n,pendingPurposes:db.prepare("SELECT count(*) AS n FROM companion_purposes WHERE status='pending'").get().n});
  return {append,list,forget,invalidate,plan,planSocial,incoming,due,current,claim,finish,snapshot,purposes,planPurpose,updatePurposes,purposeFor};
}
