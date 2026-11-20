"""Bounded public-video worker. Receives only a normalized job via stdin.
No browser cookie borrowing, no shell, no model/tool execution here.
"""
import html, json, math, os, re, subprocess, sys
from pathlib import Path
import yt_dlp

class VideoFailure(Exception):
    def __init__(self, code, message): self.code, self.message = code, message

warnings = []
phase = "resolving"
class Logger:
    def debug(self, msg): pass
    def warning(self, msg): warnings.append(str(msg))
    def error(self, msg): warnings.append(str(msg))

def emit(value):
    global phase
    if value.get("stage"): phase=value["stage"]
    print(json.dumps(value, ensure_ascii=False), flush=True)
def failure_code(message):
    m = message.lower()
    if any(s in m for s in ['private video','not available','has been removed','deleted','video unavailable','权限','付费','会员','http error 404','http error 403']): return 'UNAVAILABLE'
    if any(s in m for s in ['sign in','login','log in','cookies','登录','验证','http error 412','http error 429']): return 'LOGIN_REQUIRED'
    if any(s in m for s in ['timed out','network','getaddrinfo','proxy','unable to download webpage','remote end closed','connection']): return 'NETWORK'
    return 'EXTRACTOR_INCOMPATIBLE'

def subtitle_segments(text, ext):
    if ext == 'json3':
        data = json.loads(text)
        return [{'start':e.get('tStartMs',0)/1000,'end':(e.get('tStartMs',0)+e.get('dDurationMs',0))/1000,'text':''.join(s.get('utf8','') for s in e.get('segs',[])).strip()} for e in data.get('events',[]) if e.get('segs')]
    if ext == 'json':
        data=json.loads(text)
        return [{'start':r['from'],'end':r['to'],'text':r['content']} for r in data.get('body',[])]
    def timestamp(value):
        n=value.replace(',','.').split(':');return sum(float(x)*60**i for i,x in enumerate(reversed(n)))
    segments=[]
    for block in re.split(r'\n\s*\n',text.replace('\r','')):
        lines=block.split('\n');idx=next((i for i,line in enumerate(lines) if '-->' in line),None)
        if idx is None: continue
        times=re.match(r'\s*([\d:.,]+)\s*-->\s*([\d:.,]+)',lines[idx])
        if not times: continue
        value=html.unescape(re.sub(r'<[^>]+>','', ' '.join(lines[idx+1:]))).strip()
        if value:segments.append({'start':timestamp(times[1]),'end':timestamp(times[2]),'text':value})
    return segments

def canonical_short_target(value,platform):
    from urllib.parse import urlparse,parse_qs
    u=urlparse(value)
    if u.scheme not in ['https','http'] or u.username or u.password or u.port:raise VideoFailure('INVALID_LINK','短链跳转地址不符合公开视频限制')
    if platform=='bilibili' and u.hostname in ['www.bilibili.com','bilibili.com','m.bilibili.com']:
        match=re.fullmatch(r'/video/(BV[a-zA-Z0-9]{10})/?',u.path)
        if match:
            p=int(parse_qs(u.query).get('p',['1'])[0])
            if not 1<=p<=1000:raise VideoFailure('INVALID_PART','短链指定分P无效')
            return 'https://www.bilibili.com/video/'+match[1]+'/?p='+str(p),p
    if platform=='douyin' and u.hostname in ['www.douyin.com','douyin.com','www.iesdouyin.com','iesdouyin.com']:
        match=re.fullmatch(r'/(?:video|share/video)/(\d{10,25})/?',u.path)
        if match:return 'https://www.douyin.com/video/'+match[1],1
    raise VideoFailure('UNSUPPORTED_LINK','短链没有指向同平台的单个公开视频，不处理主页、收藏或合集')

def run(job):
    from urllib.parse import urlparse
    source=job['source'];url=source['url'];u=urlparse(url)
    if u.scheme!='https' or u.hostname not in ['www.bilibili.com','b23.tv','www.douyin.com','v.douyin.com','www.youtube.com'] or u.username or u.port: raise VideoFailure('INVALID_LINK','只允许支持平台的公开视频')
    work=Path(job['work']).resolve();work.mkdir(mode=0o700,parents=True,exist_ok=True)
    limit=job['maxBytes'];duration_limit=job['maxDurationSeconds']
    def progress(info):
        if (info.get('downloaded_bytes') or 0)>limit or (info.get('total_bytes') or 0)>limit: raise VideoFailure('SIZE_LIMIT','音频或视频超过下载大小上限')
    opts={'quiet':True,'no_warnings':True,'logger':Logger(),'proxy':job['proxy'],'noplaylist':True,'playlist_items':str(source.get('p',1)),
        'writesubtitles':True,'writeautomaticsub':True,'subtitleslangs':['zh.*','en.*','ja.*','ko.*','-danmaku','-live_chat'],
        'skip_download':False,'socket_timeout':15,'retries':1,'extractor_retries':1,'fragment_retries':0,
        'format':'bestaudio[protocol=https]/bestaudio[protocol=http]/worst[protocol=https]/worst[protocol=http]',
        'outtmpl':str(work/'media.%(ext)s'),'max_filesize':limit,'progress_hooks':[progress],
        'concurrent_fragment_downloads':1,'cachedir':False,'writeinfojson':False,'writethumbnail':False,'writecomments':False,
        'geo_bypass':False,'allow_unplayable_formats':False,'js_runtimes':{},'remote_components':[]}
    cookie=job.get('cookieFile')
    if cookie:opts['cookiefile']=cookie
    emit({'stage':'resolving'})
    with yt_dlp.YoutubeDL(opts) as ydl:
        if source.get('kind')=='short':
            with ydl.urlopen(url) as response:resolved,p=canonical_short_target(response.url,source['platform'])
            url=resolved;source={**source,'url':resolved,'p':p}
        info=ydl.extract_info(url,download=False)
        if info.get('_type') in ['playlist','multi_video']:
            if source['platform']!='bilibili' or not re.search(r'BV[a-zA-Z0-9]{10}',str(info.get('id') or '')):raise VideoFailure('UNSUPPORTED_LINK','只处理一个视频，不自动展开主页、收藏或播放列表')
            entries=iter(info.get('entries') or []);info=next(entries,None)
            if not info:raise VideoFailure('UNAVAILABLE','指定分P不存在或视频不可访问')
            if info.get('_type') in ['url','url_transparent']:info=ydl.extract_info(info['url'],download=False)
        if info.get('is_live') or info.get('live_status')=='is_live':raise VideoFailure('LIVE_UNSUPPORTED','当前只总结已发布的视频，不处理正在直播的内容')
        duration=float(info.get('duration') or 0)
        if not math.isfinite(duration) or duration<=0:raise VideoFailure('EXTRACTOR_INCOMPATIBLE','解析器未提供完整时长，不能确认是否处理全片')
        if duration>duration_limit:raise VideoFailure('DURATION_LIMIT',f'视频超过当前 {duration_limit//60} 分钟时长上限')
        if info.get('availability') in ['private','premium_only','subscriber_only','needs_auth']:raise VideoFailure('UNAVAILABLE','该视频需要私人或付费权限，默认只处理公开视频')
        metadata={'platform':source['platform'],'id':str(info.get('id') or source['id']),'p':source.get('p',1),'title':str(info.get('title') or '未命名视频')[:400],
            'duration':duration,'url':info.get('webpage_url') or url,'uploader':str(info.get('uploader') or '')[:150],
            'partCount':int(info.get('playlist_count') or info.get('n_entries') or 1)}
        if source['platform']=='bilibili':
            match=re.search(r'BV[a-zA-Z0-9]{10}', str(info.get('id') or url))
            if match:
                metadata['id']=match[0]
                actual_part=re.search(r'_p(\d+)',str(info.get('id') or ''))
                metadata['p']=int(actual_part[1]) if actual_part else source.get('p',1)
                with ydl.urlopen('https://api.bilibili.com/x/player/pagelist?bvid='+metadata['id']) as response:
                    pages=json.loads(response.read(1024*1024)).get('data',[])
                if not isinstance(pages,list) or not 1<=metadata['p']<=len(pages):raise VideoFailure('INVALID_PART','指定分P不存在，未处理其他分P')
                metadata['partCount']=len(pages)
                metadata['partTitle']=str(pages[metadata['p']-1].get('part') or '')[:300]
                metadata['url']='https://www.bilibili.com/video/'+metadata['id']+'/?p='+str(metadata['p'])
                # yt-dlp's primary DASH URL may be a PCDN peer on an arbitrary
                # port. Select the official same-CID CDN backups, never widen
                # the network allowlist to untrusted peer domains.
                play=ydl.get_info_extractor('BiliBili')._download_playinfo(metadata['id'],pages[metadata['p']-1]['cid'],headers={'Referer':metadata['url']},query={'try_look':1},fatal=False) or {}
                backups=[]
                for i,audio in enumerate((play.get('dash') or {}).get('audio') or []):
                    for n,value in enumerate([audio.get('baseUrl'),audio.get('base_url'),*(audio.get('backupUrl') or audio.get('backup_url') or [])]):
                        if not value:continue
                        parsed=urlparse(value)
                        if parsed.hostname and parsed.hostname.endswith(('.bilivideo.com','.bilivideo.cn','.bilivideo.net')) and parsed.port in [None,80,443]:
                            backups.append({'url':value.replace('http://','https://',1),'format_id':f'public-audio-{i}-{n}','ext':'m4a','vcodec':'none','acodec':'mp4a.40.2','http_headers':{'Referer':metadata['url']},'tbr':audio.get('bandwidth',0)/1000,'protocol':'https'})
                if backups:info['formats']=backups
        emit({'stage':'subtitles','metadata':metadata})
        subtitle_state='none';segments=[];subtitle_language=None;subtype=None
        for key,values in [('subtitles',info.get('subtitles') or {}),('automatic',info.get('automatic_captions') or {})]:
            langs=sorted([k for k in values if k not in ['danmaku','live_chat'] and not k.startswith('danmaku')],key=lambda l:(0 if l.startswith('zh') else 1 if l.startswith('en') else 2,l))
            for lang in langs[:2]:
                tracks=sorted([r for r in values[lang] if r.get('ext') in ['json3','json','vtt','srt']],key=lambda r:['json3','json','vtt','srt'].index(r['ext']))
                for track in tracks[:2]:
                    try:
                        if track.get('data') is not None: text=track['data']
                        else:
                            with ydl.urlopen(track['url']) as response:
                                body=response.read(5*1024*1024+1)
                                if len(body)>5*1024*1024: raise ValueError('subtitle too large')
                                text=body.decode('utf-8-sig')
                        candidate=subtitle_segments(text,track['ext'])
                        if candidate:segments=candidate;subtitle_state='available';subtitle_language=lang;subtype=key;break
                    except Exception:subtitle_state='fetch_failed'
                if segments:break
            if segments:break
        if not segments and any('logged in' in w.lower() or 'login' in w.lower() for w in warnings):subtitle_state='login_required'
        if not segments and any('subtitle' in w.lower() and ('unable' in w.lower() or 'error' in w.lower()) for w in warnings):subtitle_state='fetch_failed'
        mode='subtitles'
        if segments and max(r['end'] for r in segments)<duration-max(15,duration*.12):segments=[];subtitle_state='incomplete'
        if not segments:
            if any('preview will be extracted' in w.lower() or 'only a preview' in w.lower() or '试看' in w for w in warnings):raise VideoFailure('UNAVAILABLE','平台仅提供试看片段，不能冒充全片总结')
            emit({'stage':'downloading','subtitleStatus':subtitle_state})
            # Subtitle writes are off for audio fallback: never download danmaku.
            ydl.params.update({'writesubtitles':False,'writeautomaticsub':False})
            result=ydl.process_ie_result(info,download=True)
            files=[p for p in work.glob('media.*') if p.is_file() and p.suffix not in ['.part','.json','.vtt','.srt','.xml']]
            if len(files)!=1:raise VideoFailure('EXTRACTOR_INCOMPATIBLE','没有取得完整的单个音频文件')
            media=files[0]
            if media.stat().st_size>limit:raise VideoFailure('SIZE_LIMIT','下载超过大小上限')
            wav=work/'speech.wav'
            ffmpeg=job['ffmpeg']
            completed=subprocess.run([ffmpeg,'-nostdin','-v','error','-threads','1','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,mp3,wav,aac,ogg,flv','-i',str(media),'-t',str(duration+5),'-vn','-ac','1','-ar','16000',str(wav)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
            if completed.returncode:raise VideoFailure('AUDIO_DECODE','完整音频解码失败，未生成总结')
            audio_duration=(wav.stat().st_size-44)/32000
            if audio_duration<duration- max(3,duration*.04):raise VideoFailure('INCOMPLETE_AUDIO','音频长度短于视频，不能声称已总结全片')
            emit({'stage':'transcribing','subtitleStatus':subtitle_state})
            from faster_whisper import WhisperModel
            model_dir=Path(job['modelDirectory'])
            if not (model_dir/'model.bin').is_file():raise VideoFailure('ASR_NOT_READY','本地语音转写模型尚未安装')
            model=WhisperModel(str(model_dir),device='cpu',compute_type='int8',cpu_threads=1,num_workers=1,local_files_only=True)
            result,asr_info=model.transcribe(str(wav),beam_size=3,vad_filter=True,condition_on_previous_text=False)
            segments=[{'start':r.start,'end':r.end,'text':r.text.strip(),'uncertain':r.avg_logprob< -1 or r.no_speech_prob>.6} for r in result if r.text.strip()]
            subtitle_language=asr_info.language;mode='asr'
        segments=[{'start':round(float(r['start']),2),'end':round(float(r['end']),2),'text':r['text'].strip(),**({'uncertain':True} if r.get('uncertain') else {})} for r in segments if r.get('text','').strip()]
        if not segments:raise VideoFailure('NO_SPEECH','没有可用字幕或可辨认语音，不能凭标题总结')
        if any(not math.isfinite(r['start']) or not math.isfinite(r['end']) or r['start']<0 or r['end']<r['start'] or r['end']>duration+30 for r in segments):raise VideoFailure('INVALID_TRANSCRIPT','转录时间戳与视频时长不匹配')
        if len(json.dumps(segments,ensure_ascii=False))>3*1024*1024:raise VideoFailure('TRANSCRIPT_LIMIT','完整转录超过单任务上限，请拆分视频')
        return {'metadata':metadata,'segments':segments,'mode':mode,'language':subtitle_language,'subtitleStatus':subtitle_state,'captionType':subtype,'visualAnalysis':False,'fullAudioProcessed':mode=='asr'}

if __name__=='__main__':
    try:emit({'result':run(json.load(sys.stdin))})
    except VideoFailure as e:emit({'error':{'code':e.code,'message':e.message}});sys.exit(1)
    except Exception as e:
        # Do not emit raw downloader exceptions: signed URLs/cookies can appear.
        code='ASR_FAILED' if phase=='transcribing' else failure_code(str(e))
        diagnostic=re.sub(r'https?://[^\s]+','[url]',str(e))[:700]
        emit({'error':{'code':code,'message':{'ASR_FAILED':'本地语音转写未完成，未生成总结','UNAVAILABLE':'视频已删除、不可公开访问或无权限','LOGIN_REQUIRED':'平台要求登录或人机验证，尚未借用任何管理员凭据','NETWORK':'平台网络不可达或代理连接失败','EXTRACTOR_INCOMPATIBLE':'当前解析方式与平台不兼容，未取得真实正文'}[code],'diagnostic':type(e).__name__+': '+diagnostic}});sys.exit(1)
