import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {safeQqImageUrl,imageKey,createChatImageCache} from './qq-chat-media.mjs';

import {openChatStorage} from './qq-chat-storage.mjs';

const limit = 300;
const mediaName = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
const clone = value => structuredClone(value);
export function isLocalChatRequest(req) {
  if (!['127.0.0.1:3789', 'localhost:3789', '[::1]:3789'].includes(req.headers.host)) return false;
  if (!req.headers.origin) return true;
  return ['http://127.0.0.1:3789', 'http://localhost:3789', 'http://[::1]:3789'].includes(req.headers.origin);
}
function imageUrl(value) {
  try {
    const url = new URL(String(value).replaceAll('&amp;', '&'));
    if (url.protocol === 'https:' && ['multimedia.nt.qq.com.cn', 'gchat.qpic.cn', 'c2cpicdw.qpic.cn'].includes(url.hostname)) return url.href;
  } catch {}
  return null;
}
function segments(message) {
  if (Array.isArray(message)) return message;
  const result = []; let cursor = 0;
  for (const match of String(message || '').matchAll(/\[CQ:(\w+),([^\]]*)\]/g)) {
    if (match.index > cursor) result.push({ type: 'text', data: { text: message.slice(cursor, match.index) } });
    result.push({ type: match[1], data: Object.fromEntries(match[2].split(',').map(part => {
      const at = part.indexOf('='); return [part.slice(0, at), part.slice(at + 1).replaceAll('&#44;', ',').replaceAll('&#91;', '[').replaceAll('&#93;', ']')];
    })) });
    cursor = match.index + match[0].length;
  }
  if (cursor < String(message || '').length) result.push({ type: 'text', data: { text: message.slice(cursor) } });
  return result;
}

export async function openQqChat({ directory, allowedGroups, allowedUsers = () => [], chatGroups=allowedGroups, chatUsers=allowedUsers, manualCall=null, resolveMentions=null, remoteImages=false, fetchOneBotImage=null, fetchOneBotMessage=null, oneBotApiBase, fetchImpl = fetch, onRecord=null }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const store = openChatStorage(directory);
  let data = store.data;
  let tail = Promise.resolve();
  const enqueue = work => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
  function commit(work, bump = true) {
    try {
      return store.write(() => {
        const value = work();
        if (bump) store.set('meta','revision',data.revision + 1);
        return value;
      });
    } finally { data = store.data; }
  }
  const mutate = work => enqueue(() => commit(work));
  function cachedImage(input, pending) {
    const key=imageKey(input);
    pending.set(key,input);
    return `/api/qq/chat/image/${key}`;
  }
  function saveImages(pending) {
    for(const [key,descriptor] of pending) store.set('media',key,descriptor);
  }
  const imageCache=createChatImageCache({directory:join(directory,'media'),lookup:store.image,refresh:async input=>{
    if(input.file&&fetchOneBotImage&&(!/^https?:/i.test(input.file)||safeQqImageUrl(input.file))){try{const fresh=await fetchOneBotImage(input.file);if(fresh.url&&safeQqImageUrl(fresh.url)!==safeQqImageUrl(input.url))return fresh.url;}catch{}}
    if(input.messageId&&fetchOneBotMessage){const raw=await fetchOneBotMessage(input.messageId);const pics=segments(raw.message||raw.raw_message).filter(s=>s.type==='image');const img=pics[input.index||0]?.data;
      if(input.conversationId&&!input.conversationId.startsWith('private:')&&String(raw.group_id)!==input.conversationId)throw new Error('无法确认图片所属群聊');
      if(img?.file&&fetchOneBotImage&&(!/^https?:/i.test(img.file)||safeQqImageUrl(img.file))){try{const fresh=await fetchOneBotImage(img.file);if(fresh.url&&safeQqImageUrl(fresh.url)!==safeQqImageUrl(input.url))return fresh.url;}catch{}}return img?.url;}
  }});
  // Recover uncertain sends and normalize legacy remote-image URLs once.
  commit(() => {
    const pending=new Map();
    for(const [id,entry] of Object.entries(data.requests)) {
      if(entry.status==='sending')store.set('requests',id,{...entry,status:'unknown'});
    }
    for(const [id,entries] of Object.entries(data.groups)){
      const next=entries.map(entry=>{
        const patch={};
        if(entry.status==='sending')patch.status='unknown';
        if(remoteImages && entry.images?.some(safeQqImageUrl)) {
          patch.images=entry.images.map((url,index)=>safeQqImageUrl(url)
            ?cachedImage({url:safeQqImageUrl(url),messageId:entry.messageId,index,conversationId:id},pending):url);
        }
        return Object.keys(patch).length?{...entry,...patch}:entry;
      });
      if(next.some((item,i)=>item!==entries[i]))store.group(id,next);
    }
    saveImages(pending);
  },false);
  const allowed = id => String(id).startsWith('private:')
    ? allowedUsers().map(String).includes(String(id).slice(8)) : allowedGroups().map(String).includes(String(id));
  const assertAllowed = id => { if (!/^(?:private:)?\d{5,13}$/.test(String(id)) || !allowed(id)) throw new Error('这个会话未加入白名单'); };
  const chatAllowed=id=>String(id).startsWith('private:')?chatUsers().map(String).includes(String(id).slice(8)):chatGroups().map(String).includes(String(id));
  const assertChatAccess=id=>{if(!/^(?:private:)?\d{5,13}$/.test(String(id))||!chatAllowed(id))throw new Error('这个会话不是当前 QQ 好友或群聊');};
  async function content(message,context={},pending) {
    let text = ''; const images = [], cards = [];
    for (const segment of segments(message)) {
      const d = segment.data || {};
      if (segment.type === 'text') text += String(d.text || '');
      else if (segment.type === 'at') text += d.qq === 'all' ? '@全体成员 ' : `@${d.qq || '群友'} `;
      else if (segment.type === 'image') {
        const url = safeQqImageUrl(d.url || d.file);
        if(remoteImages&&(url||d.file&&!/^(?:base64|https?):/i.test(String(d.file)))){images.push(cachedImage({url,file:String(d.file||''),...context,index:images.length},pending));}
        else if (url) images.push(url);
        else if (String(d.file || '').startsWith('base64://')) {
          const bytes = Buffer.from(d.file.slice(9), 'base64');
          const ext = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
            : bytes[0] === 255 && bytes[1] === 216 ? 'jpg'
              : bytes.subarray(0,3).toString() === 'GIF' ? 'gif'
                : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'webp' : null;
          if (ext && bytes.length <= 6 * 1024 * 1024) {
            await mkdir(join(directory, 'media'), { recursive: true, mode: 0o700 });
            const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
            await writeFile(join(directory, 'media', name), bytes, { mode: 0o600 });
            images.push(`/api/qq/chat-media/${name}`);
          } else text += '[图片]';
        } else text += '[图片]';
      } else if (segment.type === 'face') text += '[表情]';
      else if (['record', 'voice', 'audio'].includes(segment.type)) text += '[语音]';
      else if (segment.type === 'file') text += `[文件：${String(d.name || d.file || '附件').slice(0,120)}]`;
      else if (segment.type === 'reply') text += '[引用消息] ';
      else if (segment.type === 'json') {
        try {
          const card=JSON.parse(d.data);const detail=card.meta?.detail_1 || card.meta?.news || {};
          let url=null;try {const u=new URL(detail.qqdocurl || detail.url || detail.jumpUrl);if(['https:','http:'].includes(u.protocol))url=u.href;}catch{}
          cards.push({title:String(detail.title || card.prompt || 'QQ 小程序 / 分享卡片').slice(0,160),
            description:String(detail.desc || '').slice(0,300),url,appId:String(detail.appid || '').slice(0,40)});
        }catch{text+='[小程序 / 分享卡片]';}
      }
      else text += `[${segment.type === 'video' ? '视频' : '附件'}]`;
    }
    return { text, images, cards };
  }
  function append(entry) {
    const entries=data.groups[entry.groupId] || [];
    const old=entries.find(e=>e.id===entry.id || (entry.messageId && e.messageId===entry.messageId));
    if(old){
      if(entry.source==='ai')store.group(entry.groupId,entries.map(e=>e===old?{...e,...entry}:e));
      return;
    }
    const next=[...entries,entry].sort((a,b)=>String(a.at??'').localeCompare(String(b.at??'')));
    store.group(entry.groupId,next.slice(-limit));
  }
  async function record({ groupId, userId, messageId, senderId, senderName, at, message, direction = 'incoming', source = 'qq', status = 'received' }) {
    groupId=userId?`private:${userId}`:String(groupId);
    if(!chatAllowed(groupId))return;
    const {entry,fresh}=await enqueue(async()=>{
      const old=messageId==null?null:data.groups[groupId]?.find(e=>e.messageId===String(messageId));
      if(old&&source!=='ai')return {entry:clone(old),fresh:false};
      const pending=new Map();
      const entry={id:messageId==null?randomUUID():`qq:${messageId}`,groupId,
        messageId:messageId==null?undefined:String(messageId),senderId:String(senderId||''),senderName:senderName||'群友',
        at:at||new Date().toISOString(),direction,source,status,
        ...await content(message,{messageId:messageId==null?undefined:String(messageId),conversationId:groupId},pending)};
      commit(()=>{ saveImages(pending);append(entry); });
      return {entry,fresh:true};
    });
    if(fresh)try{await onRecord?.(clone(entry));}catch(e){console.warn('QQ optional group digest record failed:',e.message);}
    return clone(entry);
  }
  async function ingest(raw) {
    if (!['private','group'].includes(raw.message_type) || !['message', 'message_sent'].includes(raw.post_type) || raw.message_id == null) return;
    const self = String(raw.user_id) === String(raw.self_id);
    const userId=raw.message_type==='private' ? (self ? raw.target_id : raw.user_id) : undefined;
    if (raw.message_type==='private' && !userId) return;
    return record({ groupId: raw.group_id, userId, messageId: raw.message_id, senderId: raw.user_id,
      senderName: raw.sender?.card || raw.sender?.nickname || (self ? '狐宫静' : String(raw.user_id)),
      at: Number.isFinite(Number(raw.time)) && raw.time ? new Date(Number(raw.time)*1000).toISOString() : undefined,
      message: raw.message || raw.raw_message, direction: self ? 'outgoing' : 'incoming' });
  }
  async function seed(memory) {
    if (data.seeded) return;
    await mutate(() => {
      for (const [groupId, entries] of Object.entries(memory.recentMessages || {})) {
        if (!allowed(groupId)) continue;
        for (const e of entries) append({ id: e.messageId ? `qq:${e.messageId}` : `legacy:${groupId}:${e.at}:${e.senderId}`,
          groupId, at: e.at, senderId: e.senderId, senderName: e.senderLabel || '群友', text: e.text || '', images: [],
          direction: 'incoming', source: 'history', status: 'received' });
      }
      for (const [groupId, entries] of Object.entries(memory.entries || {})) {
        if (!allowed(groupId)) continue;
        for (const e of entries) if (e.reply) append({ id: `legacy-reply:${groupId}:${e.at}`, groupId, at: e.at,
          senderName: '狐宫静', text: e.reply.replace(/\[\[qq_(?:image|sticker):[^\]]+\]\]/g, '[图片]'), images: [],
          direction: 'outgoing', source: 'history', status: 'sent' });
      }
      store.set('meta','seeded',true);
    });
  }
  let namesAt = 0; let namesPending;
  async function conversations() {
    if (Date.now() - namesAt > 600000 && !namesPending) {
      namesAt = Date.now();
      namesPending = (async () => {
        try {
          const response = await fetchImpl(`${oneBotApiBase}/get_group_list`, { signal: AbortSignal.timeout(4000) });
          const body = await response.json();
          if (response.ok && body.status === 'ok' && Array.isArray(body.data)) await mutate(() => {
            for (const group of body.data) if (allowed(group.group_id)) store.set('names',String(group.group_id),String(group.group_name || group.group_id));
          });
        } catch {} finally { namesPending = null; }
      })();
    }
    if (namesPending) await namesPending;
    return allowedGroups().map(String).map(id => {
      const entries = data.groups[id] || []; const last = entries.at(-1);
      return { id, name: data.names[id] || `QQ群 ${id}`, count: entries.length, lastAt: last?.at,
        lastId: last?.id, preview: last ? (last.text || (last.images?.length ? '[图片]' : '')) : '暂无聊天记录' };
    }).sort((a,b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  }
  const sends = new Map();
  async function send(input) {
    const groupId = input.userId ? `private:${input.userId}` : String(input.groupId || ''); const text = String(input.text || ''); const requestId = String(input.requestId || '');
    assertChatAccess(groupId);
    let image=null;
    if(input.imageBase64){
      if(typeof input.imageBase64!=='string' || input.imageBase64.length > 7*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.imageBase64)) throw new Error('图片内容无效或超过 5 MB');
      const bytes=Buffer.from(input.imageBase64,'base64');
      if(bytes.length>5*1024*1024 || !/^image\//.test(input.imageType || '')) throw new Error('图片超过 5 MB 或类型无效');
      const supported=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes[0]===255&&bytes[1]===216)
        || ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()) || (bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP');
      if(!supported)throw new Error('只支持 PNG、JPEG、GIF 或 WebP 图片');
      image={type:'image',data:{file:`base64://${input.imageBase64}`}};
    }
    const mentionIds=input.mentions||[];
    if(!Array.isArray(mentionIds)||mentionIds.length>20||mentionIds.some(id=>typeof id!=='string'||!/^\d{5,13}$/.test(id)))throw new Error('@ 成员数据无效，最多选择 20 位成员');
    if(mentionIds.length&&(groupId.startsWith('private:')||!resolveMentions))throw new Error('只有群聊支持 @ 群成员');
    if ((!text.trim() && !image&&!mentionIds.length) || text.length > 2000) throw new Error('请输入 1–2000 字的消息或选择图片');
    if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('发送编号无效，请刷新页面');
    const reply=input.replyMessageId ? data.groups[groupId]?.find(e=>e.messageId===String(input.replyMessageId)) : null;
    if(input.replyMessageId && !reply)throw new Error('引用消息不在当前会话');
    const uniqueMentions=[...new Set(mentionIds)];
    const message=[...(reply?[{type:'reply',data:{id:reply.messageId}}]:[]),...uniqueMentions.flatMap(id=>[{type:'at',data:{qq:id}},{type:'text',data:{text:' '}}]),...(text?[{type:'text',data:{text}}]:[]),...(image?[image]:[])];
    const fingerprint=createHash('sha256').update(JSON.stringify({groupId,text,image:input.imageBase64 || '',reply:reply?.messageId || '',...(uniqueMentions.length?{mentions:uniqueMentions}:{})})).digest('hex');
    if (sends.has(requestId)) {
      const pending=sends.get(requestId);
      if(pending.fingerprint!==fingerprint)throw new Error('发送编号已用于另一条消息');
      return pending.promise;
    }
    const work = (async () => {
      const old = data.requests[requestId];
      if (old) {
        if (old.groupId !== groupId || (old.inputText??old.text) !== text || (old.fingerprint ? old.fingerprint!==fingerprint : Boolean(image || reply))) throw new Error('发送编号已用于另一条消息');
        return { ok: old.status === 'sent', ...clone(old), status: old.status === 'sending' ? 'unknown' : old.status };
      }
      const mentionNames=uniqueMentions.length?await resolveMentions(groupId,uniqueMentions):[];
      const pending=new Map();
      const entry = { id: `manual:${requestId}`, groupId, senderName: '狐宫静', direction: 'outgoing', source: 'manual',
        ...await content(message,{},pending),text:[...mentionNames.map(m=>`@${m.name}`),text].filter(Boolean).join(' '),fingerprint,inputText:text,at: new Date().toISOString(), status: 'sending' };
      await mutate(() => { saveImages(pending);store.set('requests',requestId,entry);append(entry); });
      let result;
      try {
        const privateChat=groupId.startsWith('private:');
        const action=privateChat?'send_private_msg':'send_group_msg',params={ [privateChat?'user_id':'group_id']: Number(privateChat?groupId.slice(8):groupId), message };
        if(manualCall){const response=await manualCall(action,params);result=response?.message_id!=null?{status:'sent',messageId:String(response.message_id)}:{status:'unknown',error:'QQ 未返回消息编号'};}
        else {const r=await fetchImpl(`${oneBotApiBase}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(25000)});const body=await r.json();
          result=r.ok&&body.status==='ok'&&body.retcode===0&&body.data?.message_id!=null?{status:'sent',messageId:String(body.data.message_id)}:{status:body.status==='failed'?'failed':'unknown',error:body.message||'发送未确认，请检查 QQ 后再试'};}
      } catch { result = { status: 'unknown', error: '连接中断，发送结果未确认，请检查 QQ 后再试' }; }
      await mutate(() => {
        const sent={...entry,...result};
        store.set('requests',requestId,sent);
        // A self-message event can arrive before the API receipt.
        const current=data.groups[groupId]||[];
        store.group(groupId,current.filter(e=>!result.messageId||e.id!==`qq:${result.messageId}`).map(e=>e.id===entry.id?sent:e));
        const ids=Object.keys(data.requests);
        for(const id of ids.slice(0,Math.max(0,ids.length-2000)))store.set('requests',id,undefined);
      });
      return {ok:result.status==='sent',...clone(entry),...result};
    })();
    sends.set(requestId, {promise:work,fingerprint});
    try { return await work; } finally { sends.delete(requestId); }
  }
  return { record, ingest, seed, conversations, send,
    revision(){return data.revision;},
    storageMode:store.mode,
    rollbackStorage:()=>enqueue(()=>{const result=store.rollback();data=store.data;return result;}),
    async preview(message,context={}){
      const pending=new Map(),result=await content(message,context,pending);
      if(pending.size)await enqueue(()=>commit(()=>saveImages(pending),false));
      return result;
    },
    assertAllowed,assertChatAccess,
    async allConversations(directory){
      if(directory){return [...directory.groups,...directory.friends].map(c=>{const entries=data.groups[c.id]||[],last=entries.at(-1);return {...c,count:entries.length,lastAt:last?.at,lastId:last?.id,preview:last?.text||(last?.images?.length?'[图片]':'暂无聊天记录'),aiAllowed:allowed(c.id)};}).sort((a,b)=>(b.lastAt||'').localeCompare(a.lastAt||'')||a.name.localeCompare(b.name,'zh-CN'));}
      const groups=(await conversations()).map(g=>({...g,type:'group'}));
      const users=allowedUsers().map(String).map(id=>{const key=`private:${id}`,entries=data.groups[key]||[],last=entries.at(-1);
        const incoming=[...entries].reverse().find(e=>e.direction==='incoming');
        return {id:key,type:'private',name:incoming?.senderName || `QQ ${id}`,count:entries.length,lastAt:last?.at,lastId:last?.id,preview:last?.text || (last?.images?.length?'[图片]':'暂无聊天记录')};});
      return [...groups,...users].sort((a,b)=>(b.lastAt||'').localeCompare(a.lastAt||''));
    },
    messages(id) { assertChatAccess(id); return clone(data.groups[String(id)] || []); },
    recentMessages(id,count=120) { assertChatAccess(id);if(!Number.isInteger(count)||count<1||count>120)throw new Error('近期消息范围无效');return clone((data.groups[String(id)]||[]).slice(-count)); },
    async restore(id,messageId){
      assertChatAccess(id);const old=data.groups[id]?.find(m=>m.messageId===String(messageId));if(!old||!fetchOneBotMessage)throw new Error('原消息不在此会话记录中');
      const raw=await fetchOneBotMessage(messageId);
      if(!id.startsWith('private:')&&String(raw.group_id)!==id)throw new Error('无法确认原消息所属群聊');
      if(id.startsWith('private:')&&(raw.message_type!=='private'||old.direction!=='outgoing'&&String(raw.sender?.user_id||raw.user_id)!==id.slice(8)))throw new Error('无法确认原私聊消息来源');
      const pending=new Map();
      const restored=await content(raw.message||raw.raw_message,{messageId:String(messageId),conversationId:id},pending);
      if(!restored.images.length&&String(old.text).includes('[图片]'))throw new Error('QQ 已无法提供这张历史图片，请让对方重新发送');
      return mutate(()=>{
        const current=data.groups[id]||[], entry=current.find(e=>e.messageId===String(messageId));
        if(!entry)throw Error('原消息已超出本会话记录范围');
        const result={...entry,...restored};
        saveImages(pending);store.group(id,current.map(e=>e===entry?result:e));return clone(result);
      });
    },
    async media(name) { if (!mediaName.test(name)) throw new Error('Invalid media'); return readFile(join(directory, 'media', name)); },
    async remoteMedia(key){const descriptor=store.image(key);if(!descriptor)throw new Error('图片记录不存在');if(descriptor.conversationId)assertChatAccess(descriptor.conversationId);return imageCache.read(key);}
  };
}
