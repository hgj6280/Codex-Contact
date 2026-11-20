import {createHash} from 'node:crypto';

export const GROUP_MEMORY_POLICY=Object.freeze({recentPerGroup:240,recentAgeMs:7*86400000,topicsPerGroup:400,topicGapMs:15*60000,batchSize:12,maxEvidence:6,promptBudget:700,maxMatches:4});
export const GROUP_DIALOGUE_GUIDANCE='群聊是多人并行对话：按QQ号区分同名群友，分清本条作者、引用作者和@对象。不同话题不拼成一段；别人向第三人说的话不当作对你说。群内原话只证明那个人当时这样说过，不自动变成本次提问者的喜好、你的经历或全群共识。玩笑、转述、角色扮演不写成真人身份；情绪只参考当前说话者，不把全群情绪或对产品的批评当作对你生气。指代或事实冲突时就近核对，仍不明确才简短确认。';
const validId=x=>/^\d{5,13}$/.test(String(x||''));
const clip=(s,n)=>Array.from(String(s||'').toWellFormed()).slice(0,n).join('');
const hash=s=>createHash('sha256').update(s).digest('hex');
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const timestamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function groupPeriod(at,level='day'){
  const date=day.format(new Date(at));
  if(level==='year')return date.slice(0,4);
  if(level==='month')return date.slice(0,7);
  if(level==='week'){
    const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);
  }
  return date;
}

// A source-backed group index alongside the existing personal memories. Period
// views use the SAME original excerpts, never summaries of generated summaries.
// No model, extra process, scheduler, vector store or message-send transport.
export function openGroupMemory(db,{terms,hasSecret,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS group_memory_messages(id TEXT PRIMARY KEY,room TEXT NOT NULL,messageId TEXT NOT NULL,user TEXT NOT NULL,name TEXT NOT NULL,text TEXT NOT NULL,replyTo TEXT,quoteAuthor TEXT,targets TEXT NOT NULL,topic TEXT NOT NULL,terms TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS group_memory_recent ON group_memory_messages(room,at);
    CREATE INDEX IF NOT EXISTS group_memory_topic ON group_memory_messages(room,topic,at);
    CREATE TABLE IF NOT EXISTS group_memory_notes(id TEXT PRIMARY KEY,room TEXT NOT NULL,topic TEXT NOT NULL,items TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(room,topic));
    CREATE INDEX IF NOT EXISTS group_memory_note_room ON group_memory_notes(room,at);
    CREATE VIRTUAL TABLE IF NOT EXISTS group_memory_search USING fts5(id UNINDEXED,terms);`);
  function owner(e){return e.type!=='private_message'&&validId(e.groupId)&&validId(e.senderId)?{room:String(e.groupId),user:String(e.senderId)}:null;}
  function observe(e){
    const o=owner(e),messageId=String(e.raw?.message_id??e.messageId??'');
    if(!o||!messageId||messageId.length>128||e.desktopDraft||String(e.senderId)===String(e.selfId))return false;
    const id=hash(o.room+'|'+messageId);
    if(db.prepare('SELECT 1 FROM group_memory_messages WHERE id=?').get(id))return false;
    const rawTime=Number(e.raw?.time)*1000,at=Number.isFinite(rawTime)&&rawTime>0?rawTime:now();
    if(at>now()+30000||now()-at>GROUP_MEMORY_POLICY.recentAgeMs)return false;
    const text=clip(String(e.text||'').replace(/\[CQ:[^\]]*\]|\[\[qq_[\s\S]*?\]\]/g,''),400).trim();
    if(!text||text.startsWith('/')||hasSecret(text))return false;
    const quote=e.replyContext,cross=quote?.raw?.group_id!=null&&String(quote.raw.group_id)!==o.room;
    const replyTo=cross?null:String(e.replyMessageId||quote?.messageId||'')||null;
    const targets=[...new Set((e.atTargets||[]).map(String).filter(validId))].slice(0,8);
    const tokens=terms(text),tokenSet=new Set(tokens);
    const recent=db.prepare('SELECT * FROM group_memory_messages WHERE room=? AND at<=? AND at>=? ORDER BY at DESC LIMIT 24').all(o.room,at,at-GROUP_MEMORY_POLICY.topicGapMs);
    const parent=replyTo?db.prepare('SELECT * FROM group_memory_messages WHERE room=? AND messageId=?').get(o.room,replyTo):null;
    let topic=parent?.topic;
    if(!topic){
      const ranked=recent.map(r=>{const rt=JSON.parse(r.terms),overlap=rt.filter(t=>tokenSet.has(t)).length;
        const compatible=(!targets.length&&!JSON.parse(r.targets).length)||targets.includes(r.user)||JSON.parse(r.targets).includes(o.user);
        return {r,overlap,score:compatible?overlap/Math.sqrt(Math.max(1,tokens.length*rt.length)):-1};
      }).filter(x=>x.overlap>=2&&x.score>=.16).sort((a,b)=>b.score-a.score||b.r.at-a.r.at);
      topic=ranked[0]?.r.topic||id;
    }
    db.prepare('INSERT OR IGNORE INTO group_memory_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,o.room,messageId,o.user,clip(e.senderLabel||e.senderName||o.user,40),text,replyTo,cross?null:String(quote?.senderId||'')||null,JSON.stringify(targets),topic,JSON.stringify(tokens),at);
    const count=db.prepare('SELECT count(*) AS n FROM group_memory_messages WHERE room=? AND topic=?').get(o.room,topic).n;
    if(count>=GROUP_MEMORY_POLICY.batchSize&&count%GROUP_MEMORY_POLICY.batchSize===0)consolidate(o.room,topic);
    // Only this derived working set is bounded; never touch QQ chat originals.
    db.prepare('DELETE FROM group_memory_messages WHERE room=? AND (at<? OR id IN (SELECT id FROM group_memory_messages WHERE room=? ORDER BY at DESC,rowid DESC LIMIT -1 OFFSET ?))').run(o.room,now()-GROUP_MEMORY_POLICY.recentAgeMs,o.room,GROUP_MEMORY_POLICY.recentPerGroup);
    return true;
  }
  function writeNote(room,topic,items){
    const id=hash(room+'|'+topic);db.prepare('DELETE FROM group_memory_search WHERE id=?').run(id);
    if(!items.length){db.prepare('DELETE FROM group_memory_notes WHERE id=?').run(id);return;}
    db.prepare('INSERT INTO group_memory_notes VALUES(?,?,?,?,?) ON CONFLICT(room,topic) DO UPDATE SET items=excluded.items,at=excluded.at').run(id,room,topic,JSON.stringify(items),Math.max(...items.map(x=>x.at)));
    db.prepare('INSERT INTO group_memory_search VALUES(?,?)').run(id,[...new Set(items.flatMap(x=>terms(x.name+' '+x.user+' '+x.text)))].join(' '));
    // A bounded derived index, not another unlimited copy of chat history.
    const expired=db.prepare('SELECT id FROM group_memory_notes WHERE room=? ORDER BY at DESC,rowid DESC LIMIT -1 OFFSET ?').all(room,GROUP_MEMORY_POLICY.topicsPerGroup);
    for(const row of expired){db.prepare('DELETE FROM group_memory_search WHERE id=?').run(row.id);db.prepare('DELETE FROM group_memory_notes WHERE id=?').run(row.id);}
  }
  function consolidate(room,topic){
    const old=db.prepare('SELECT items FROM group_memory_notes WHERE room=? AND topic=?').get(room,topic);
    const rows=db.prepare('SELECT messageId,user,name,text,replyTo,quoteAuthor,targets,at,rowid AS ordinal FROM group_memory_messages WHERE room=? AND topic=? ORDER BY at DESC,rowid DESC LIMIT 24').all(room,topic).reverse();
    const seen=new Map((old?JSON.parse(old.items):[]).map(r=>[r.messageId,r]));
    for(const row of rows)seen.set(row.messageId,{...row,targets:JSON.parse(row.targets)});
    // Preserve distinct speakers and newest corrections, with exact excerpts.
    const all=[...seen.values()].sort((a,b)=>b.at-a.at||(b.ordinal||0)-(a.ordinal||0)),chosen=[],authors=new Set();
    for(const row of all){if(!authors.has(row.user)){chosen.push(row);authors.add(row.user);}if(chosen.length>=GROUP_MEMORY_POLICY.maxEvidence)break;}
    for(const row of all){if(chosen.length>=GROUP_MEMORY_POLICY.maxEvidence)break;if(!chosen.some(x=>x.messageId===row.messageId))chosen.push(row);}
    writeNote(room,topic,chosen.sort((a,b)=>a.at-b.at||(a.ordinal||0)-(b.ordinal||0)));
  }
  function delivered(e){
    const o=owner(e);if(!o||e.desktopDraft)return;
    const row=db.prepare('SELECT topic FROM group_memory_messages WHERE id=?').get(hash(o.room+'|'+String(e.raw?.message_id??e.messageId??'')));
    if(row)consolidate(o.room,row.topic);
  }
  function list(e,{query=e.text||'',level='topic',limit=GROUP_MEMORY_POLICY.maxMatches}={}){
    const o=owner(e);if(!o)return [];
    limit=Math.max(1,Math.min(12,Number(limit)||4));
    const tokens=terms(query).slice(0,12),match=tokens.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR ');
    let rows;
    if(match)rows=db.prepare('SELECT n.* FROM group_memory_search JOIN group_memory_notes n ON n.id=group_memory_search.id WHERE group_memory_search MATCH ? AND n.room=? ORDER BY bm25(group_memory_search),n.at DESC LIMIT ?').all(match,o.room,limit);
    else rows=db.prepare('SELECT * FROM group_memory_notes WHERE room=? ORDER BY at DESC LIMIT ?').all(o.room,limit);
    return rows.map(r=>({...r,period:groupPeriod(r.at,level),items:JSON.parse(r.items),level:['day','week','month','year'].includes(level)?level:'topic'}));
  }
  function context(e){
    const o=owner(e),tokens=terms(e.text||'');if(!o||!tokens.length)return {text:'',references:[]};
    // Plain short-term conversations stay in selectQqContext. This is only
    // relevant older/group-shared evidence; never scan every group on reply.
    const rows=list(e),references=[],lines=['【当前群的话题记忆：群内原话节选，不是事实认证或人物设定】'];let used=lines[0].length;
    for(const note of rows){
      for(const item of note.items.toReversed()){
        if(item.messageId===String(e.raw?.message_id)||!terms(item.name+' '+item.user+' '+item.text).some(t=>tokens.includes(t)))continue;
        const row={id:item.messageId,author:item.user,name:item.name,at:timestamp.format(new Date(item.at)),text:clip(item.text,100),...(item.replyTo?{replyTo:item.replyTo}:{}),...(item.quoteAuthor?{quoteAuthor:item.quoteAuthor}:{})};
        const line=JSON.stringify(row);if(used+line.length+1>GROUP_MEMORY_POLICY.promptBudget)continue;
        lines.push(line);used+=line.length+1;references.push({groupId:o.room,messageId:item.messageId,authorId:item.user,at:item.at});
      }
    }
    return {text:references.length?lines.join('\n'):'',references};
  }
  function forget(room,user){
    if(!validId(room)||!validId(user))return;
    db.prepare('DELETE FROM group_memory_messages WHERE room=? AND user=?').run(String(room),String(user));
    const notes=db.prepare("SELECT * FROM group_memory_notes n WHERE room=? AND EXISTS(SELECT 1 FROM json_each(n.items) i WHERE json_extract(i.value,'$.user')=?)").all(String(room),String(user));
    for(const n of notes)writeNote(n.room,n.topic,JSON.parse(n.items).filter(i=>i.user!==String(user)));
  }
  function clear(room){
    const notes=room?db.prepare('SELECT id FROM group_memory_notes WHERE room=?').all(room):db.prepare('SELECT id FROM group_memory_notes').all();
    for(const n of notes)db.prepare('DELETE FROM group_memory_search WHERE id=?').run(n.id);
    if(room){db.prepare('DELETE FROM group_memory_messages WHERE room=?').run(room);db.prepare('DELETE FROM group_memory_notes WHERE room=?').run(room);}
    else db.exec('DELETE FROM group_memory_messages;DELETE FROM group_memory_notes;');
  }
  return {observe,delivered,context,list,forget,clear,snapshot:()=>({version:1,policy:{...GROUP_MEMORY_POLICY},workingMessages:db.prepare('SELECT count(*) AS n FROM group_memory_messages').get().n,topics:db.prepare('SELECT count(*) AS n FROM group_memory_notes').get().n,extraModelCalls:0})};
}
