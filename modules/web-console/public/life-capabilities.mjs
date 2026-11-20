const $=id=>document.getElementById(id);
async function api(path,body){const r=await fetch('/api/life/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
function node(tag,text){const e=document.createElement(tag);if(text)e.textContent=text;return e;}
function section(title,detail){const s=node('section');s.append(node('h2',title),node('p',detail));document.querySelector('main').append(s);return s;}
function input(parent,label,type,value){const l=node('label',label),i=node('input');i.type=type;if(type==='checkbox')i.checked=Boolean(value);else i.value=value||'';l.append(i);parent.append(l);return i;}
function button(parent,label,fn){const b=node('button',label);parent.append(b);b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){$('notice').textContent=e.message;}finally{b.disabled=false;}};return b;}
export async function capabilities(){
  const cfg=await api('state');
  const nav=node('div');nav.className='actions';document.querySelector('main header').after(nav);for(const [label,id] of [['Live2D 动作','live2d-settings'],['声音','voice-settings'],['B站扩展','bili-extensions']])button(nav,label,async()=>document.getElementById(id).scrollIntoView({block:'start'}));
  const l2d=section('Live2D 动作','模型使用你提供的 Q 版狐宫静。15 FPS；隐藏窗口暂停，关闭分身释放画布。');
  l2d.id='live2d-settings';
  const info=node('p');l2d.append(info);async function l2dState(){const s=await api('live2d');info.textContent=(s.modelReady?'模型已导入':'未导入模型')+' · '+(s.coreReady?'运行库已安装，重新打开分身即可播放':'运行库尚未安装');}await l2dState();
  const terms=node('a','查看官方 SDK 软件许可 ↗');terms.href='https://www.live2d.com/en/sdk/download/web/';terms.target='_blank';terms.rel='noopener';l2d.append(terms);
  const accept=input(l2d,'我已阅读并同意上述官方 SDK 软件许可，仅在本机使用','checkbox',false);
  button(l2d,'同意许可后安装官方运行库',async()=>{if(!accept.checked)throw Error('请由本人阅读并确认官方许可');await api('live2d/install',{licenseAccepted:true});await l2dState();$('notice').textContent='官方运行库已安装；关闭再打开分身加载 Live2D。';});
  const voice=await api('voice'),vs=section('声音复刻 · 本机按需合成','独立 MLX 环境；合成时加载，完成后进程退出，平时不占模型内存。首次约下载 1.6 GB 权重；没有音频素材时保持系统语音，不下载权重。');
  vs.id='voice-settings';
  vs.append(node('p',(voice.pythonReady?'语音环境已准备':'语音环境未准备')+' · '+(voice.modelReady?'权重已缓存，合成无需联网':'首次使用需下载权重')+' · '+(voice.referenceReady?'已导入：'+(voice.referenceLabel||'参考音频'):'尚缺参考音频')));
  const clone=input(vs,'使用复刻声音（关闭时使用系统声音）','checkbox',voice.provider==='clone'),path=input(vs,'3至30秒 PCM WAV 参考音频的本地完整路径','text',''),transcript=input(vs,'参考音频中的准确台词','text',voice.transcript),consent=input(vs,'素材是本人声音或已获得声音本人授权','checkbox',voice.consent);
  const qqVoice=input(vs,'开启 QQ 语音回复（群聊与私聊）','checkbox',voice.qqEnabled);
  const modeLabel=node('label','QQ 回复方式'),mode=node('select');for(const [id,label] of [['text','文字：始终打字'],['voice','语音：优先语音'],['mixed','掺半：文字和语音搭配'],['smart','智能：被友好打趣时用语音'],['on_request','仅明确要求时用语音']]){const o=node('option',label);o.value=id;mode.append(o);}mode.value=voice.qqMode||'on_request';modeLabel.append(mode);vs.append(modeLabel);
  const percent=input(vs,'掺半模式的语音比例（0至100%，默认50%）','number',voice.qqMixedPercent??50);percent.min='0';percent.max='100';
  const ratesLabel=node('label','指定群的语音比例（可选，每行“群号:百分比”）'),rates=node('textarea');rates.rows=3;rates.value=Object.entries(voice.qqGroupVoiceRates||{}).map(([id,p])=>id+':'+p).join('\n');ratesLabel.append(rates);vs.append(ratesLabel);
  vs.append(node('p','仅在本会话 AI 已开启且允许回复时生效。智能模式复用回复模型判断；图片、链接和管理结果保留文字。合成繁忙时先用文字，不阻塞其他群。'));
  const readRates=()=>{const result={};for(const line of rates.value.split(/\n/).filter(x=>x.trim())){const m=line.trim().match(/^(\d{5,15})\s*[:：]\s*(\d{1,3})%?$/);if(!m||Number(m[2])>100)throw Error('各群比例请填写“群号:0至100”');result[m[1]]=Number(m[2]);}return result;};
  button(vs,'保存声音设置',async()=>{await api('voice/settings',{provider:clone.checked?'clone':'system',qqEnabled:qqVoice.checked,qqMode:mode.value,qqMixedPercent:Number(percent.value),qqGroupVoiceRates:readRates(),reference:path.value.trim(),transcript:transcript.value,consent:consent.checked});$('notice').textContent='声音设置已保存，QQ 群聊与私聊语音立即生效；桌面声音重新打开分身后生效。';});
  const sample=node('audio');sample.controls=true;sample.hidden=true;sample.preload='none';vs.append(sample);let nativePreview=false,trialPending=false;
  button(vs,'试听群聊音色（不发送 QQ）',async()=>{trialPending=true;$('notice').textContent='正在合成群聊试听…';let r;try{r=await api('voice/qq-preview',{text:'在呢，我是狐宫静，很高兴和你聊天。'});}finally{trialPending=false;}sample.pause();sample.src=r.url;sample.hidden=false;try{await sample.play();$('notice').textContent='群聊音色已生成，SILK 转码通过；没有发送 QQ。';}catch{$('notice').textContent='群聊音色已生成，点击播放器试听；没有发送 QQ。';}});
  window.addEventListener('nativeSpeech',e=>{if(!nativePreview)return;$('notice').textContent=e.detail.speaking?'系统语音正在播放…':'系统语音播放结束。';if(!e.detail.speaking)nativePreview=false;});
  button(vs,'试听已保存的声音',async()=>{const v=await api('voice'),text='在呢，我是狐宫静。今天也想陪你聊一会儿。';if(v.provider==='clone'){$('notice').textContent='正在本机合成；首次需要下载权重，请稍等…';trialPending=true;let r;try{r=await api('voice/speak',{text});}finally{trialPending=false;}sample.pause();sample.src=r.url;sample.hidden=false;try{await sample.play();$('notice').textContent='已开始播放复刻声音。';}catch{$('notice').textContent='声音已合成，点击播放器播放。';}}else if(window.webkit?.messageHandlers?.qqDesktop){nativePreview=true;$('notice').textContent='已请求系统语音试听。';window.webkit.messageHandlers.qqDesktop.postMessage({action:'speak',text});}else throw Error('请在桌面 App 中试听系统声音');});
  button(vs,'停止试听',async()=>{sample.pause();nativePreview=false;window.webkit?.messageHandlers?.qqDesktop?.postMessage({action:'stopSpeaking'});await api('voice/cancel',{});$('notice').textContent='已停止试听。';});window.addEventListener('pagehide',()=>{sample.pause();if(trialPending)fetch('/api/life/voice/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}',keepalive:true}).catch(()=>{});},{once:true});
  const bs=section('B站私信、直播弹幕与自动发现','私信首次开启只建立基线，不补发历史；直播仅回应触发词。与 QQ 私人记忆隔离，不执行管理动作；不确定的发送结果不会重发。');
  bs.id='bili-extensions';
  const discover=input(bs,'自动从真实推荐列表发现新视频','checkbox',cfg.biliDiscover),dm=input(bs,'自动回复收到的新文字私信','checkbox',cfg.biliDmEnabled),live=input(bs,'直播弹幕监听与回复','checkbox',cfg.biliLiveEnabled),room=input(bs,'直播间号','text',cfg.biliRoomId),words=input(bs,'直播触发词（逗号分隔）','text',cfg.biliLiveWords.join('，')),limit=input(bs,'B站每天最多回复条数','number',cfg.biliReplyLimit);
  button(bs,'保存 B站扩展设置',async()=>{const latest=await api('state');const saved=await api('settings',{revision:latest.revision,biliDiscover:discover.checked,biliDmEnabled:dm.checked,biliLiveEnabled:live.checked,biliRoomId:room.value.trim(),biliLiveWords:words.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),biliReplyLimit:Number(limit.value)});window.dispatchEvent(new CustomEvent('lifeSettingsSaved',{detail:saved}));$('notice').textContent='已保存；自动发现仍遵守上方自主浏览开关、作息和专注设置。';});
  button(bs,'现在发现一个视频（只读取，不发布）',async()=>{const x=await api('bili/discover',{});if(!x.bvid)throw Error('当前推荐中暂无未读候选');const v=await api('bili/read',{video:x.bvid});$('notice').textContent='发现并读取：'+v.title+' · '+v.subtitleStatus;});
  const log=node('div');bs.append(log);button(bs,'刷新 B站接收与回复记录',async()=>{const s=await api('bili/social');log.replaceChildren(node('p',(s.connected?'直播已连接':'直播未连接')+(s.lastError?' · '+s.lastError:'')));for(const e of s.events){log.append(node('p',`${e.channel} · ${e.scope} · ${e.status}：${e.text}${e.reply?' → '+e.reply:''}${e.reason?' · '+e.reason:''}`));}});
}
