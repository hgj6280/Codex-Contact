// One central account-wide gate for native QQ message submissions. Reservations
// survive timeouts/restarts; never retry an uncertain send to use up a quota.
import {DatabaseSync} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const valid=x=>/^\d{5,13}$/.test(String(x||''));
const initial={dailyLimit:2000,perMinute:20,revision:'initial'};
export async function openQqSendBudget(path,{now=Date.now}={}){
  await mkdir(dirname(path),{recursive:true,mode:0o700});const db=new DatabaseSync(path);await chmod(path,0o600);
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=500;PRAGMA cache_size=-256;
    CREATE TABLE IF NOT EXISTS send_settings(account TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS send_seeds(account TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(account,day));
    CREATE TABLE IF NOT EXISTS send_reservations(id TEXT PRIMARY KEY,account TEXT NOT NULL,day TEXT NOT NULL,at INTEGER NOT NULL,state TEXT NOT NULL,message TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS send_message ON send_reservations(account,message) WHERE message IS NOT NULL;
    CREATE INDEX IF NOT EXISTS send_day ON send_reservations(account,day,at);`);
  db.exec('CREATE INDEX IF NOT EXISTS send_recent ON send_reservations(account,at)');
  db.exec("UPDATE send_reservations SET state='unknown' WHERE state='reserved'");
  db.prepare('DELETE FROM send_reservations WHERE at<?').run(now()-35*86400000);
  function settings(account){if(!valid(account))throw Error('QQ账号未确认');return {...initial,...JSON.parse(db.prepare('SELECT data FROM send_settings WHERE account=?').get(String(account))?.data||'{}')};}
  function snapshot(account){const config=settings(account),day=dayFormat.format(new Date(now())),rows=db.prepare('SELECT state,count(*) AS n FROM send_reservations WHERE account=? AND day=? GROUP BY state').all(String(account),day),used=rows.reduce((s,r)=>s+r.n,0),confirmed=rows.filter(r=>['sent','observed'].includes(r.state)).reduce((s,r)=>s+r.n,0),minute=db.prepare('SELECT count(*) AS n FROM send_reservations WHERE account=? AND at>?').get(String(account),now()-60000).n;
    return {...config,account:String(account),day,timeZone:'Asia/Shanghai',used,confirmed,uncertain:used-confirmed,remaining:Math.max(0,config.dailyLimit-used),minuteUsed:minute,canSend:used<config.dailyLimit&&minute<config.perMinute};}
  function update(account,input){const old=settings(account);if(input.revision!==old.revision)throw Object.assign(Error('发送限制已更新，请重新读取'),{status:409});if(!Number.isInteger(input.dailyLimit)||input.dailyLimit<1||input.dailyLimit>2000||!Number.isInteger(input.perMinute)||input.perMinute<1||input.perMinute>60)throw Error('每日最多2000条，每分钟须为1–60条');const next={dailyLimit:input.dailyLimit,perMinute:input.perMinute,revision:randomUUID()};db.prepare('INSERT OR REPLACE INTO send_settings VALUES(?,?)').run(String(account),JSON.stringify(next));return snapshot(account);}
  function reserve(account){db.exec('BEGIN IMMEDIATE');try{const state=snapshot(account);if(!state.canSend){const e=Object.assign(Error(state.remaining?'本分钟发送较多，暂不继续发送':'今天的QQ发送额度已到上限，明天恢复'),{code:state.remaining?'QQ_RATE_LIMIT':'QQ_DAILY_LIMIT'});throw e;}const id=randomUUID();db.prepare('INSERT INTO send_reservations VALUES(?,?,?,?,?,NULL)').run(id,String(account),state.day,now(),'reserved');db.exec('COMMIT');return id;}catch(e){db.exec('ROLLBACK');throw e;}}
  function finish(id,result){const row=db.prepare('SELECT * FROM send_reservations WHERE id=?').get(id);if(!row)return;const message=result?.status==='ok'&&result.retcode===0&&result.data?.message_id!=null?String(result.data.message_id):null;db.exec('BEGIN IMMEDIATE');try{if(message)db.prepare("DELETE FROM send_reservations WHERE account=? AND message=? AND id<>? AND state='observed'").run(row.account,message,id);const duplicate=message&&db.prepare('SELECT id FROM send_reservations WHERE account=? AND message=? AND id<>?').get(row.account,message,id);db.prepare('UPDATE send_reservations SET state=?,message=? WHERE id=?').run(message?'sent':'unknown',duplicate?null:message,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  function observe(event){if(!valid(event.self_id)||event.message_id==null||String(event.user_id)!==String(event.self_id)&&event.post_type!=='message_sent')return;const account=String(event.self_id),message=String(event.message_id);db.prepare('INSERT OR IGNORE INTO send_reservations VALUES(?,?,?,?,?,?)').run(randomUUID(),account,dayFormat.format(new Date(now())),now(),'observed',message);}
  function seed(account,count){settings(account);if(!Number.isInteger(count)||count<0)throw Error('历史计数无效');const day=dayFormat.format(new Date(now()));if(db.prepare('SELECT count FROM send_seeds WHERE account=? AND day=?').get(String(account),day))return snapshot(account);db.exec('BEGIN IMMEDIATE');try{for(let i=0;i<Math.min(2000,count);i++)db.prepare('INSERT INTO send_reservations VALUES(?,?,?,?,?,NULL)').run(randomUUID(),String(account),day,now()-60001,'historical');db.prepare('INSERT INTO send_seeds VALUES(?,?,?)').run(String(account),day,count);db.exec('COMMIT');return snapshot(account);}catch(e){db.exec('ROLLBACK');throw e;}}
  return {settings,snapshot,update,reserve,finish,observe,seed,close:()=>db.close()};
}
