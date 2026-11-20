import {bindConversationAiBulk} from './conversation-ai-bulk.mjs';
import {bindGroupDigestEditor} from './group-digest-editor.mjs';
import {bindImageSearchEditor} from './image-search-editor.mjs';
import {bindVoiceEditor} from './voice-editor.mjs';
import {safeMediaUrl,recipient,pollDelay,unreadCount,compactTokens,avatarInitial} from './desktop-state.mjs';
import {bindManagement} from './desktop-management.mjs';
import {bindMentions} from './desktop-mentions.mjs';
import {createDesktopTransport,createChatImageLoader} from './desktop-transport.mjs';
import {bindPersonalityEditor} from './personality-editor.mjs';
import {bindTriggerEditor} from './trigger-editor.mjs';
import {bindConversationAi} from './conversation-ai-editor.mjs';
import {bindFastModeToggle} from './fast-mode-editor.mjs';
import {bindImageModelEditor} from './image-model-editor.mjs';
import {bindCompanionEditor} from './companion-editor.mjs';
import {bindAutonomyEditor} from './autonomy-editor.mjs';
import {bindRoleEditor} from './role-editor.mjs';
import {bindKnowledgeEditor} from './knowledge-editor.mjs';
import {bindSendBudgetEditor} from './send-budget-editor.mjs';
const $=id=>document.getElementById(id);
const native=window.webkit?.messageHandlers?.qqDesktop;
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function saveLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
let selected=readLocal('qq-desktop-selected',''),filter='all',conversations=[],messages=[],limit=80;
let connected=null,desktopState=null,active=true,polling=false,sending=false,initialized=false,timer,noticeTimer,replyId=null,attachment=null,unknownSend=false;
let listTag='',messageTags=new Map(),messageCaches=new Map(),stickers=[],stickerLimit=42;
let messageNodes=new Map(),nodeConversation='',localSending=null;
let sessionLimit=120;
const seen=readLocal('qq-desktop-seen',{}),texts=readLocal('qq-desktop-drafts',{}),jobs=readLocal('qq-desktop-jobs',{}),drafts=new Map(Object.entries(readLocal('qq-desktop-draft-results',{})));
const saveDrafts=()=>saveLocal('qq-desktop-draft-results',Object.fromEntries(drafts));
const transport=createDesktopTransport({onEvent:event=>{const saved=readLocal('qq-desktop-network',[]),log=Array.isArray(saved)?saved:[];log.push({...event,at:new Date().toISOString()});saveLocal('qq-desktop-network',log.slice(-40));renderNetworkDiagnostics();}});
const chatImages=createChatImageLoader({root:$('messages')});
const messageFailures=new Map();
function renderNetworkDiagnostics(){
  const saved=readLocal('qq-desktop-network',[]),log=Array.isArray(saved)?saved:[];
  $('networkDiagnostics').textContent=log.length?log.slice(-20).map(e=>`${new Date(e.at).toLocaleTimeString('zh-CN')} ${e.method} ${e.path}\n${e.ms} ms · ${e.error||e.status}`).join('\n\n'):'还没有请求记录。这里只记录接口、耗时与错误类型，不记录消息内容。';
}
function notice(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('toast').hidden=true,5500);}
async function api(path,body){
  return transport.api(path,body);
}
async function cached(path,tag){
  return transport.cached(path,tag);
}
function nativeAction(action,extra={}){
  if(native){native.postMessage({action,...extra});return;}
  if(action==='openLogin'){window.open(desktopState?.backend?.engine==='snowluma'?'http://127.0.0.1:6081/vnc.html?autoconnect=1&resize=scale':'http://127.0.0.1:6099/webui/web_login','_blank','noopener');api('/api/qq/chat/recover-login',{}).catch(error=>notice(error.message));}
  else if(action==='openLife')window.open('/life.html','_blank','noopener');
  else if(action==='openManager')window.open('/client.html','_blank','noopener');
  else notice('此功能需要在「狐宫静 QQ」桌面 App 内使用。');
}
function setTheme(theme){document.documentElement.dataset.theme=theme;saveLocal('qq-desktop-theme',theme);$('theme').querySelector('.rail-icon').textContent=theme==='dark'?'☀':'☾';$('theme').querySelector('.rail-label').textContent=theme==='dark'?'日间':'夜间';$('theme').title=theme==='dark'?'切换日间模式':'切换夜间模式';$('theme').setAttribute('aria-label',$('theme').title);native?.postMessage({action:'theme',dark:theme==='dark'});}
setTheme(readLocal('qq-desktop-theme',matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
$('theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
function drawer(panel){$('drawer').hidden=false;$('drawerTitle').textContent={ai:'AI 创作',settings:'设置',sticker:'表情包',contacts:'联系人与申请',group:'群成员与管理',mention:'@ 群成员'}[panel];for(const name of ['ai','settings','sticker','contacts','group','mention'])$(name+'Panel').hidden=name!==panel;}
const management=bindManagement({api,drawer,notice,selected:()=>selected,refresh:async()=>{listTag='';await poll();}});
const mentions=bindMentions({api,drawer,notice,selected:()=>selected,update:updateComposer});
const personalityEditor=bindPersonalityEditor({root:$('personalityEditor'),api});
const imageSearchEditor=bindImageSearchEditor({root:$('imageSearchEditor'),api});
const voiceEditor=bindVoiceEditor({root:$('voiceEditor'),api,advanced:()=>nativeAction('openLife')});
const triggerEditor=bindTriggerEditor({root:$('triggerEditor'),api});
const fastModeEditor=bindFastModeToggle({root:$('fastModeEditor'),api});
const imageModelEditor=bindImageModelEditor({root:$('imageModelEditor'),api});
const companionEditor=bindCompanionEditor({root:$('companionEditor'),api,selected:()=>selected});
const knowledgeEditor=bindKnowledgeEditor({root:$('knowledgeEditor'),api,selected:()=>selected});
const sendBudgetEditor=bindSendBudgetEditor({root:$('sendBudgetEditor'),api});
const groupDigestEditor=bindGroupDigestEditor({root:$('groupDigestEditor'),api,selected:()=>selected});
const conversationAiBulk=bindConversationAiBulk({root:$('conversationAiBulk'),api,conversations:()=>conversations,onChanged:async()=>{await refreshState();await refreshConversations();}});
const roleEditor=bindRoleEditor({root:$('roleEditor'),api,selected:()=>selected});
const autonomyEditor=bindAutonomyEditor({root:$('autonomyEditor'),api,selected:()=>selected});
const conversationAi=bindConversationAi({toggle:$('autoAI'),api,selected:()=>selected,
  conversation:()=>conversations.find(c=>c.id===selected),notice,onRender:({enabled,globalEnabled,authorized,loading})=>{
    const c=conversations.find(x=>x.id===selected);if(!c)return;
    const muted=desktopState?.deliveryBlocks?.find(g=>g.groupId===c.id);
    $('subtitle').textContent=`${c.type==='private'?'私聊':'QQ群'} · ${c.id.replace('private:','')} · ${muted?'账号被禁言至 '+new Date(muted.until).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):loading?'正在读取 AI 开关':!authorized?'仅手动聊天':!enabled?'本会话 AI 已关闭':!globalEnabled?'AI 总开关已关闭':'本会话 AI 已开启'} · 最近 300 条`;
  }});
$('bulkAiShortcut').onclick=()=>{drawer('settings');$('conversationAiBulk').open=true;conversationAiBulk.load();$('conversationAiBulk').scrollIntoView({block:'start'});};
$('navAI').onclick=()=>{if(!$('drawer').hidden&&!$('aiPanel').hidden)$('drawer').hidden=true;else drawer('ai');};$('navSettings').onclick=$('details').onclick=()=>{renderNetworkDiagnostics();drawer('settings');personalityEditor.load();voiceEditor.load();imageSearchEditor.load();triggerEditor.load({force:true});imageModelEditor.load();companionEditor.load();knowledgeEditor.load();sendBudgetEditor.load();roleEditor.load();groupDigestEditor.load();conversationAiBulk.load();autonomyEditor.load();};
$('aiImageSettings').onclick=()=>{drawer('settings');imageModelEditor.load();$('imageModelEditor').scrollIntoView({block:'nearest'});};
$('navChats').onclick=$('closeDrawer').onclick=()=>{$('drawer').hidden=true;};
$('navLife').onclick=()=>nativeAction('openLife');
for(const id of ['login','settingsLogin'])$(id).onclick=()=>nativeAction('openLogin');
$('openManager').onclick=()=>nativeAction('openManager');$('openArchive').onclick=()=>nativeAction('openArchive');
$('startServices').onclick=()=>{nativeAction('startServices');notice('正在检查 / 恢复后台，不重启已运行的服务，也不改变 AI 开关。');};
window.addEventListener('nativeServiceResult',event=>{notice(event.detail?.message||'后台检查已结束');listTag='';poll();});
window.addEventListener('nativeActive',event=>{active=event.detail?.active!==false;if(active)poll();});
function shortTime(at){return at?new Date(at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'';}
function renderConversations(){
  const term=$('search').value.trim().toLowerCase();
  const items=conversations.filter(c=>(filter==='all'||c.type===filter)&&`${c.name} ${c.id}`.toLowerCase().includes(term));
  const nodes=items.slice(0,sessionLimit).map(c=>{
    const button=document.createElement('button');button.className='session'+(selected===c.id?' selected':'');button.setAttribute('aria-label',`${c.type==='private'?'私聊':'群聊'} ${c.name}`);button.setAttribute('aria-pressed',String(selected===c.id));
    const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=c.type==='private'?'友':avatarInitial(c.name);
    const content=document.createElement('span'),line=document.createElement('span'),name=document.createElement('strong'),time=document.createElement('time'),preview=document.createElement('span');
    line.className='session-title';name.textContent=c.name;time.textContent=shortTime(c.lastAt);line.append(name,time);
    preview.className='session-preview';preview.textContent=c.preview||'暂无消息';content.append(line,preview);button.append(avatar,content);
    if(unreadCount(c,seen)&&c.id!==selected){const dot=document.createElement('span');dot.className='unread';dot.title='有新消息';button.append(dot);}
    button.onclick=()=>choose(c.id);return button;
  });
  if(items.length>sessionLimit){const more=document.createElement('button');more.className='load-older';more.textContent=`更多会话 (${sessionLimit}/${items.length})`;more.onclick=()=>{sessionLimit+=120;renderConversations();};nodes.push(more);}
  if(!nodes.length){const empty=document.createElement('p');empty.className='empty-small';empty.textContent=term?'没有匹配的会话':'暂无联系人，请登录 QQ 后点击同步。';nodes.push(empty);}
  $('conversations').replaceChildren(...nodes);
}
$('search').oninput=()=>{sessionLimit=120;renderConversations();};
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;sessionLimit=120;for(const b of document.querySelectorAll('[data-filter]'))b.classList.toggle('selected',b===button);renderConversations();};
function clearAttachment(){if(attachment?.url?.startsWith('blob:'))URL.revokeObjectURL(attachment.url);attachment=null;$('attachment').hidden=true;updateComposer();}
function clearReply(){replyId=null;$('replyPreview').hidden=true;}
async function choose(id){
  if(selected!==id){management.conversationChanged();mentions.conversationChanged();texts[selected]=$('input').value;saveLocal('qq-desktop-drafts',texts);if(attachment){clearAttachment();notice('已取消待发图片，避免切换会话后发错群。');}clearReply();unknownSend=false;}
  selected=id;saveLocal('qq-desktop-selected',id);limit=80;
  const c=conversations.find(x=>x.id===id);if(!c)return;
  $('title').textContent=c.name;conversationAi.render();$('manageGroup').hidden=c.type!=='group';
  $('input').value=texts[id]||'';$('input').disabled=false;seen[id]=c.lastId||'';saveLocal('qq-desktop-seen',seen);renderConversations();renderDraft();
  messages=messageCaches.get(id)||[];renderMessages(true);updateComposer();await refreshMessages(id,true);
}
function viewImage(url){$('largeImage').src=url;$('imageViewer').showModal();}
$('closeViewer').onclick=()=>{$('imageViewer').close();$('largeImage').removeAttribute('src');};
function renderMessages(scroll=false){
  const box=$('messages'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90,previousTop=box.scrollTop,oldHeight=box.scrollHeight;
  if(nodeConversation!==selected){messageNodes.clear();nodeConversation=selected;}
  const nodes=[];
  if(messages.length>limit){const more=document.createElement('button');more.className='load-older';more.textContent='加载更早消息';more.onclick=()=>{const height=box.scrollHeight;limit+=80;renderMessages();box.scrollTop+=box.scrollHeight-height;};nodes.push(more);}
  let day='';
  const visible=messages.slice(-limit);if(localSending?.groupId===selected&&!visible.some(m=>m.id===localSending.id))visible.push(localSending);
  const keep=new Set();
  for(const m of visible){
    const date=new Date(m.at).toLocaleDateString('zh-CN');if(date!==day){const label=document.createElement('div');label.className='day-label';label.textContent=date;nodes.push(label);day=date;}
    keep.add(m.id);const signature=JSON.stringify(m),saved=messageNodes.get(m.id);if(saved?.signature===signature){nodes.push(saved.row);continue;}
    const row=document.createElement('article');row.className='message'+(m.direction==='outgoing'?' outgoing':'');
    const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=m.direction==='outgoing'?'🦊':avatarInitial(m.senderName||'友');
    const body=document.createElement('div');body.className='message-body';const meta=document.createElement('div');meta.className='message-meta';meta.textContent=`${m.senderName||'群友'} · ${shortTime(m.at)}${m.source==='ai'?' · AI':''}`;
    const bubble=document.createElement('div');bubble.className='bubble';
    if(m.text){const text=document.createElement('p');text.className='message-text';text.textContent=m.text;bubble.append(text);}
    for(const value of m.images||[]){const url=safeMediaUrl(value);if(!url)continue;const img=document.createElement('img');img.className='message-image';img.decoding='async';img.alt='聊天图片';img.referrerPolicy='no-referrer';img.onclick=()=>viewImage(url);const retry=document.createElement('button');retry.className='image-retry';retry.textContent='图片暂未加载 · 点击重试';retry.hidden=true;
      const failed=()=>{img.hidden=true;retry.hidden=false;},loaded=()=>{if(nodeConversation===selected&&box.scrollHeight-box.scrollTop-box.clientHeight<180)box.scrollTop=box.scrollHeight;};
      retry.onclick=()=>{retry.hidden=true;img.hidden=false;chatImages.retry(img,url+(url.includes('?')?'&':'?')+'retry='+Date.now(),loaded,failed);};chatImages.add(img,url,loaded,failed);bubble.append(img,retry);}
    for(const card of m.cards||[]){const block=document.createElement('div');block.className='message-card';const title=document.createElement('strong');title.textContent=card.title;const desc=document.createElement('p');desc.textContent=card.description||'小程序 / 分享卡片 · 完整功能需官方 QQ';block.append(title,desc);
      if(card.url){try{const u=new URL(card.url);if(['https:','http:'].includes(u.protocol)){const link=document.createElement('a');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='在浏览器打开网页入口 ↗';block.append(link);}}catch{}}bubble.append(block);}
    const actions=document.createElement('div');actions.className='message-actions';const state=document.createElement('span');state.textContent={sending:'发送中',sent:'已发送',failed:'发送失败',unknown:'发送未确认'}[m.status]||'';if(['unknown','failed'].includes(m.status))state.className='delivery-error';actions.append(state);
    if(m.messageId){const quote=document.createElement('button');quote.textContent='引用';quote.onclick=()=>{replyId=m.messageId;$('replyText').textContent=`引用 ${m.senderName}：${m.text||'[图片]'}`;$('replyPreview').hidden=false;$('input').focus();};actions.append(quote);}
    if(m.messageId&&m.text?.includes('[图片]')&&!m.images?.length){const restore=document.createElement('button');restore.textContent='加载原图';restore.onclick=async()=>{restore.disabled=true;const id=selected;try{await api(`/api/qq/chat/restore/${id}/${m.messageId}`,{});await refreshMessages(id);}catch(e){notice(e.message);}finally{restore.disabled=false;}};actions.append(restore);}
    body.append(meta,bubble,actions);row.append(avatar,body);nodes.push(row);messageNodes.set(m.id,{row,signature});
  }
  if(!nodes.length){const empty=document.createElement('div');empty.className='welcome';const text=document.createElement('p');text.textContent=messageFailures.has(selected)?'消息暂未加载，正在自动重试；这不代表聊天记录为空。':!messageCaches.has(selected)?'正在读取聊天记录…':'这个会话还没有记录，新消息会持续同步。';empty.append(text);nodes.push(empty);}
  for(const key of messageNodes.keys())if(!keep.has(key))messageNodes.delete(key);
  const retained=new Set(nodes);for(const old of [...box.children])if(!retained.has(old))old.remove();
  for(let i=0;i<nodes.length;i++)if(box.children[i]!==nodes[i])box.insertBefore(nodes[i],box.children[i]||null);
  chatImages.prune();
  if(scroll||atBottom)box.scrollTop=box.scrollHeight;else box.scrollTop=previousTop;
}
async function refreshMessages(id=selected,force=false){
  if(!id)return;try{const result=await cached(`/api/qq/chat/${id}`,force?'':messageTags.get(id));if(!result)return;
    messageFailures.delete(id);messageTags.set(id,result.tag);messageCaches.delete(id);messageCaches.set(id,result.data.messages||[]);
    while(messageCaches.size>8){const oldest=messageCaches.keys().next().value;messageCaches.delete(oldest);messageTags.delete(oldest);messageFailures.delete(oldest);}
    if(id!==selected)return;
    messages=result.data.messages||[];renderMessages(force);const c=conversations.find(x=>x.id===id);if(c){seen[id]=c.lastId||'';saveLocal('qq-desktop-seen',seen);}
  }catch(error){messageFailures.set(id,error.code||'READ_FAILED');if(id===selected&&!messages.length)renderMessages();console.warn('QQ messages refresh failed:',error.code||error.message);}
}
function updateComposer(){$('input').disabled=!selected||sending;$('send').disabled=sending||!selected||connected===false||(!$('input').value.trim()&&!attachment&&!mentions.ids().length);for(const id of ['attach','stickers','useDraft','mention'])$(id).disabled=sending;}
$('input').oninput=()=>{texts[selected]=$('input').value;saveLocal('qq-desktop-drafts',texts);updateComposer();mentions.typed();};
$('input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(mentions.isOpen())return;if(!$('send').disabled)send();}};
async function send(){
  if(!selected||$('send').disabled)return;
  if(unknownSend&&!confirm('上一条发送结果未确认，请先在 QQ 中检查。重新发送可能重复，仍要发送吗？'))return;
  const id=selected,request={...recipient(id),text:$('input').value,mentions:mentions.ids(),requestId:crypto.randomUUID(),...(replyId?{replyMessageId:replyId}:{}),...(attachment?{imageBase64:attachment.base64,imageType:attachment.type}:{})};
  localSending={id:`manual:${request.requestId}`,groupId:id,senderName:document.querySelector('.brand-name')?.textContent||'助手',at:new Date().toISOString(),text:[...mentions.names().map(n=>`@${n}`),request.text].join(' '),images:attachment?[attachment.url]:[],direction:'outgoing',status:'sending',source:'manual'};renderMessages(true);
  sending=true;updateComposer();$('hint').textContent='正在等待 QQ 确认…';
  let acknowledged=false,resultStatus='unknown';
  try{const result=await api('/api/qq/chat/send',request);acknowledged=true;resultStatus=result.status;if(!result.ok){if(selected===id)unknownSend=result.status==='unknown';throw new Error(result.error||'QQ 未确认发送，请检查后再试');}
    if(selected===id)unknownSend=false;texts[id]='';saveLocal('qq-desktop-drafts',texts);if(selected===id){$('input').value='';mentions.clear();clearAttachment();clearReply();}$('hint').textContent='已发送 · Enter 发送，Shift+Enter 换行';listTag='';localSending=null;await refreshMessages(id,true);
  }catch(error){if(!acknowledged&&selected===id)unknownSend=true;if(localSending){localSending.status=resultStatus;renderMessages();}$('hint').textContent=error.message;notice(error.message);}finally{sending=false;updateComposer();}
}
$('send').onclick=send;$('clearAttachment').onclick=clearAttachment;$('clearReply').onclick=clearReply;
async function attachBlob(blob,name){
  const target=selected;
  if(!selected){notice('请先选择一个聊天会话');return;}
  if(blob.size>5*1024*1024){notice('图片超过 5 MB，请先压缩后再发送。');return;}
  const value=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  if(selected!==target){notice('会话已切换，已取消这张待发图片。');return;}
  clearAttachment();attachment={base64:String(value).split(',')[1],type:blob.type || 'image/png',url:URL.createObjectURL(blob),name};
  $('attachmentImage').src=attachment.url;$('attachmentName').textContent=name;$('attachment').hidden=false;updateComposer();
}
$('attach').onclick=()=>{if(!selected)return notice('请先选择会话');$('file').click();};
$('file').onchange=async()=>{const file=$('file').files[0];if(file)await attachBlob(file,file.name);$('file').value='';};
$('input').addEventListener('paste',event=>{const file=[...event.clipboardData.items].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile();if(file){event.preventDefault();attachBlob(file,'粘贴的图片');}});
function renderDraft(){const draft=drafts.get(selected);$('draftPreview').hidden=!draft;if(!draft)return;$('draftText').textContent=draft.text||'';const nodes=[];for(const value of draft.images||[]){const url=safeMediaUrl(value);if(!url)continue;const img=document.createElement('img');img.src=url;img.alt='AI 生成预览';img.onclick=()=>viewImage(url);nodes.push(img);}$('draftImages').replaceChildren(...nodes);}
$('discardDraft').onclick=()=>{drafts.delete(selected);saveDrafts();renderDraft();};
$('useDraft').onclick=async()=>{const id=selected,draft=drafts.get(id);if(!draft)return;
  if((draft.text||'').length>2000)return notice('草稿超过 2000 字，请先手动缩短。');
  try{if(draft.images?.length){const url=safeMediaUrl(draft.images[0]);if(!url)throw new Error('预览图片不可用');const response=await fetch(url);if(!response.ok)throw new Error('读取生成图失败');const blob=await response.blob();if(selected!==id)return;await attachBlob(blob,'AI 生成图片');}
    $('input').value=draft.text||'';texts[id]=$('input').value;saveLocal('qq-desktop-drafts',texts);drafts.delete(id);saveDrafts();renderDraft();updateComposer();$('input').focus();
  }catch(error){notice(error.message);}
};
$('aiWrite').onclick=()=>{drawer('ai');$('aiPrompt').value=$('input').value?`帮我把这段话写成自然的群聊回复：${$('input').value}`:'根据当前会话的最近消息，帮我拟一条自然的回复。';$('aiPrompt').focus();};
$('aiDraw').onclick=()=>{drawer('ai');$('aiPrompt').value=$('input').value||'画一张狐宫静开心的表情包，无文字。';$('aiPrompt').focus();};
$('generateDraft').onclick=async()=>{
  if(!selected)return notice('请先选择目标会话，草稿不会自动发送。');
  const id=selected;$('generateDraft').disabled=true;
  try{const job=await api('/api/qq/chat/draft',{conversationId:id,request:$('aiPrompt').value,requestId:crypto.randomUUID(),...(replyId?{replyMessageId:replyId}:{})});
    jobs[id]=job.id;saveLocal('qq-desktop-jobs',jobs);$('aiStatus').textContent='AI 正在生成预览。生图可能需要几分钟，你可以继续聊天；不做质量验收。';
  }catch(error){$('aiStatus').textContent=error.message;notice(error.message);}finally{$('generateDraft').disabled=Boolean(jobs[selected]);}
};
async function refreshJobs(){for(const [id,jobId] of Object.entries(jobs)){
  try{const job=await api(`/api/qq/chat/draft/${jobId}`);if(job.status==='running')continue;
    delete jobs[id];saveLocal('qq-desktop-jobs',jobs);
    if(job.status==='completed'){drafts.set(id,job.result);saveDrafts();if(id===selected){renderDraft();$('aiStatus').textContent='预览已完成，放入输入框后由你确认发送。';}notice('AI 草稿已完成，尚未发送到 QQ。');}
    else {if(id===selected)$('aiStatus').textContent=job.error||'AI 生成失败';notice(job.error||'AI 生成失败');}
  }catch(error){if(/不存在|重启/.test(error.message)){delete jobs[id];saveLocal('qq-desktop-jobs',jobs);$('aiStatus').textContent=error.message;}}
} $('generateDraft').disabled=Boolean(jobs[selected]);}
$('globalAI').onchange=async()=>{const toggle=$('globalAI'),desired=toggle.checked;toggle.disabled=true;try{await api('/api/channel',{channel:'qq',enabled:desired});notice(desired?'AI 总开关已开启；各会话仍沿用自己的独立开关。':'AI 总开关已关闭；各会话的独立设置已保留，手动聊天仍可使用。');await refreshState();}catch(error){toggle.checked=!desired;notice(error.message);}finally{toggle.disabled=false;}};
$('saveModel').onclick=async()=>{try{await api('/api/qq/model',{model:$('model').value});delete $('model').dataset.dirty;notice('实际调用模型已保存，从新的 AI 请求生效。');await refreshState();}catch(error){notice(error.message);}};
function renderConnection(){
  $('onlineDot').classList.toggle('online',connected===true);
  $('onlineDot').title=connected===true?'QQ 已登录':connected===false?'QQ 已确认下线':'暂未取得 QQ 登录状态，正在重试';
  $('connection').textContent=connected===true?'QQ 在线':connected===false?'QQ 离线':'连接待确认';
  const hint=$('hint');
  if(!sending){
    if(connected!==true){hint.dataset.connectionHint='true';const recovery=desktopState?.nativeRecovery;hint.textContent=['awaiting_scan','recovering','backoff','offline','waiting_io','blocked'].includes(recovery?.phase)?recovery.message:connected===false?'QQ 已下线，请扫码登录。':'连接状态暂未确认，正在重试；手动发送时后台会重新校验。';}
    else if(hint.dataset.connectionHint||hint.textContent==='后台暂不可用，可在设置中恢复服务。'){delete hint.dataset.connectionHint;hint.textContent='Enter 发送 · Shift+Enter 换行';}
  }
  updateComposer();
}
async function refreshState(){
  let s;
  try{s=await api('/api/qq/chat/desktop-state');}
  catch(error){connected=null;renderConnection();throw error;}
  desktopState=s;fastModeEditor.update(s.fastMode);imageModelEditor.update(s.imageGeneration);connected=typeof s.online==='boolean'?s.online:null;renderConnection();
  $('aiImageSettings').textContent=`生图模型：${s.imageGeneration?.provider==='nano-banana-2'?'Gemini · Nano Banana 2':'GPT · '+(s.imageGeneration?.gptModel||'Codex')} · 更改`;
  if(s.personaName&&document.querySelector('.brand-name'))document.querySelector('.brand-name').textContent=s.personaName;
  $('account').textContent=s.account?`${s.account.name} · ${s.account.id}`:'狐宫静 QQ';if(!$('globalAI').disabled)$('globalAI').checked=s.aiEnabled;conversationAi.update(s.conversationAi,s.aiEnabled);conversationAiBulk.update(s.conversationAi);
  $('modelLabel').textContent=s.textRouting?.degraded?'GPT-6 Luna · Gemini 连接故障，临时回退':String(s.model||'未取得模型').replace('gpt-','GPT-');if(s.model&&document.activeElement!==$('model')&&!$('model').dataset.dirty)$('model').value=s.model;
  const today=s.usage?.today||{},all=s.usage?.total||{};
  $('usage').textContent=`今日 ${compactTokens(today.totalTokens)} token\n输入 ${compactTokens(today.inputTokens)} · 输出 ${compactTokens(today.outputTokens)} · 缓存 ${compactTokens(today.cachedInputTokens)}\n累计 ${compactTokens(all.totalTokens)} token`;
  updateComposer();
}
$('model').onchange=()=>{$('model').dataset.dirty='true';};
async function renderStickers(){const term=$('stickerSearch').value.trim().toLowerCase(),items=stickers.filter(s=>s.name.toLowerCase().includes(term));
  const nodes=items.slice(0,stickerLimit).map(s=>{const button=document.createElement('button');button.title=s.name;const img=document.createElement('img');img.src=s.url;img.loading='lazy';img.alt=s.name;const text=document.createElement('span');text.textContent=s.name;button.append(img,text);button.onclick=async()=>{if(!selected)return notice('请先选择会话');try{const response=await fetch(s.url);if(!response.ok)throw new Error('表情不可用');await attachBlob(await response.blob(),s.name);$('drawer').hidden=true;}catch(error){notice(error.message);}};return button;});
  if(items.length>stickerLimit){const more=document.createElement('button');more.textContent=`加载更多 (${items.length})`;more.onclick=()=>{stickerLimit+=42;renderStickers();};nodes.push(more);}$('stickerGrid').replaceChildren(...nodes);
}
$('stickers').onclick=async()=>{drawer('sticker');if(!stickers.length){try{stickers=(await api('/api/qq/chat/stickers')).stickers||[];}catch(error){notice(error.message);}}renderStickers();};
$('stickerSearch').oninput=()=>{stickerLimit=42;renderStickers();};
async function refreshConversations(){
  const result=await cached('/api/qq/chat/conversations',listTag);if(result){listTag=result.tag;conversations=result.data.conversations;
      for(const c of conversations)if(!(c.id in seen))seen[c.id]=c.lastId||'';
      if(selected&&!conversations.some(c=>c.id===selected)){selected='';messages=[];clearAttachment();clearReply();$('input').disabled=true;$('input').value='';$('title').textContent='会话权限已移除';$('messages').replaceChildren();}
      renderConversations();if((!initialized||!selected)&&conversations.length){initialized=true;await choose(selected||conversations[0].id);}}
}
async function poll(){
  clearTimeout(timer);if(polling){timer=setTimeout(poll,1500);return;}polling=true;
  try{
    // Login status is independent of conversation rendering and AI preview failures.
    // Background AI/history sync lives in the service. An inactive UI does not
    // need to fetch, render or decode new chat pictures; catch up on activation.
    const tasks=(!document.hidden&&active)?[refreshConversations(),refreshMessages(),refreshJobs()]:[];
    if(!desktopState||connected===null||Date.now()-(poll.stateAt||0)>8000){tasks.push(refreshState());poll.stateAt=Date.now();}
    const results=await Promise.allSettled(tasks);
    for(const result of results)if(result.status==='rejected')console.warn('QQ panel refresh failed:',result.reason?.message||'unknown error');
  }
  finally{polling=false;timer=setTimeout(poll,pollDelay(!document.hidden,active));}
}
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);timer=setTimeout(poll,document.hidden?15000:0);});
window.addEventListener('keydown',e=>{if(e.key==='Escape')$('drawer').hidden=true;if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();drawer('ai');$('aiPrompt').focus();}});
poll();
