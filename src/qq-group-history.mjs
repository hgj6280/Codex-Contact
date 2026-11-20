import {randomUUID} from 'node:crypto';
// Fixed read-only OneBot action and loopback endpoint. The caller binds group ID.
export function createGroupHistoryReader({getToken,WebSocketImpl=WebSocket,timeoutMs=8000}){
 return async(groupId,{before,count=100}={})=>{
  if(!/^\d{5,13}$/.test(String(groupId))||!Number.isInteger(count)||count<1||count>100||before!=null&&!/^-?\d+$/.test(String(before)))throw Error('群历史参数无效');
  const token=await getToken(),echo=randomUUID();
  return new Promise((resolve,reject)=>{let ws,done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);ws?.close();error?reject(error):resolve(value);};
   const timer=setTimeout(()=>finish(Error('群历史读取超时')),timeoutMs);
   try{ws=new WebSocketImpl(`ws://127.0.0.1:3001?access_token=${encodeURIComponent(token)}`);
    ws.onopen=()=>ws.send(JSON.stringify({action:'get_group_msg_history',params:{group_id:Number(groupId),count,...(before!=null?{message_id:Number(before)}:{})},echo}));
    ws.onmessage=({data})=>{let r;try{r=JSON.parse(data);}catch{return;}if(r.echo!==echo)return;
     if(r.status!=='ok'||r.retcode!==0||!Array.isArray(r.data?.messages))return finish(Error('QQ 当前未能提供群历史记录'));
     if(r.data.messages.some(m=>String(m.group_id)!==String(groupId)))return finish(Error('群历史来源校验失败'));
     finish(null,r.data.messages);
    };ws.onerror=()=>finish(Error('QQ 群历史连接不可用'));ws.onclose=()=>{if(!done)finish(Error('QQ 群历史连接中断'));};
   }catch{finish(Error('QQ 群历史读取失败'));}
  });
 };
}
export async function backfillGroupHistory({groupId,start,selfId,read,observe,now=Date.now,maxPages=30,maxMs=40000}){
 const began=now(),seen=new Set();let before,imported=0,pages=0,earliest=Infinity,complete=false,reason='已达到历史读取上限';
 for(;pages<maxPages&&now()-began<maxMs;){
  const rows=await read(groupId,{before,count:100});pages++;
  if(!rows.length){complete=earliest<=start;reason='QQ 未提供更早的历史记录';break;}
  const ordered=rows.slice().sort((a,b)=>Number(a.time)-Number(b.time)||Number(a.message_seq||0)-Number(b.message_seq||0));
  for(const m of ordered){
   if(String(m.group_id)!==String(groupId))throw Error('群历史来源校验失败');
   const at=Number(m.time)*1000;if(!Number.isFinite(at))continue;earliest=Math.min(earliest,at);
   if(at<start||String(m.user_id)===String(selfId)||m.message_id==null||seen.has(String(m.message_id)))continue;
   seen.add(String(m.message_id));
   const text=Array.isArray(m.message)?m.message.filter(s=>s.type==='text').map(s=>String(s.data?.text||'')).join(''):String(m.raw_message||'').replace(/\[CQ:[^\]]+\]/g,'');
   if(!text.trim())continue;
   observe({groupId:String(groupId),messageId:String(m.message_id),senderId:String(m.user_id),senderName:m.sender?.card||m.sender?.nickname||String(m.user_id),at:new Date(at).toISOString(),direction:'incoming',text});imported++;
  }
  if(earliest<=start){complete=true;reason='已翻到请求开始时间';break;}
  const next=ordered[0]?.message_id;
  if(next==null||String(next)===String(before)){reason='QQ 历史游标未继续向前，已停止重复读取';break;}
  before=next;
 }
 return {pages,imported,earliest:Number.isFinite(earliest)?new Date(earliest).toISOString():null,complete,reason};
}
