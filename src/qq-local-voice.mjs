import {mkdir,readFile,realpath,stat,access,copyFile,chmod,readdir,unlink} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {saveJsonAtomic} from './atomic-json.mjs';
import {qqVoiceModes} from './qq-voice-replies.mjs';
const exec=promisify(execFile);
function validateReference(bytes){
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('参考素材必须是未压缩的 WAV 音频');
  let rate=0,size=0;for(let i=12;i+8<=bytes.length;){const tag=bytes.toString('ascii',i,i+4),n=bytes.readUInt32LE(i+4);if(i+8+n>bytes.length)throw Error('WAV 音频不完整');if(tag==='fmt '&&n>=16){if(![1,3].includes(bytes.readUInt16LE(i+8)))throw Error('请使用 PCM 或浮点 WAV 音频');rate=bytes.readUInt32LE(i+16);}if(tag==='data')size+=n;i+=8+n+(n%2);}
  const seconds=size/rate;if(!Number.isFinite(seconds)||seconds<3||seconds>30)throw Error('参考音频需为3至30秒');
}
export async function openLocalVoice({directory,runtime,now=Date.now,run=exec}){
  await mkdir(directory,{recursive:true,mode:0o700});let settings=JSON.parse(await readFile(join(directory,'settings.json'),'utf8').catch(()=>'{}')),busy=false,pending=null,pendingChannel='desktop',closed=false;
  if(settings.reference)settings.reference=await realpath(join(directory,'reference.wav')).catch(()=>settings.reference);
  const python=join(runtime,'voice-runtime/venv/bin/python'),script=fileURLToPath(new URL('./qq-voice-worker.py',import.meta.url));
  const ready=()=>access(python).then(()=>true,()=>false);
  const modelReady=()=>access(join(runtime,'voice-runtime/model-ready.json')).then(()=>true,()=>false);
  async function snapshot(){return {provider:settings.provider||'system',qqEnabled:settings.qqEnabled===true,qqMode:settings.qqMode||'on_request',qqMixedPercent:settings.qqMixedPercent??50,qqGroupVoiceRates:{...settings.qqGroupVoiceRates},referenceReady:Boolean(settings.reference),referenceName:settings.reference?'reference.wav':null,referenceLabel:settings.referenceLabel||'',transcript:settings.transcript||'',consent:settings.consent===true,pythonReady:await ready(),modelReady:await modelReady(),busy,model:'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit',onDemand:true};}
  async function update(input){
    if(!['system','clone'].includes(input.provider))throw Error('声音模式无效');const next={...settings,provider:input.provider};
    if('qqEnabled' in input){if(typeof input.qqEnabled!=='boolean')throw Error('QQ 语音开关需为布尔值');next.qqEnabled=input.qqEnabled;}
    if('qqMode' in input){if(!qqVoiceModes.includes(input.qqMode))throw Error('QQ 回复方式无效');next.qqMode=input.qqMode;}
    if('qqMixedPercent' in input){if(!Number.isInteger(input.qqMixedPercent)||input.qqMixedPercent<0||input.qqMixedPercent>100)throw Error('语音比例需为0至100');next.qqMixedPercent=input.qqMixedPercent;}
    if('qqGroupVoiceRates' in input){const rates=input.qqGroupVoiceRates;if(!rates||typeof rates!=='object'||Array.isArray(rates)||Object.keys(rates).length>200||Object.entries(rates).some(([id,p])=>!/^\d{5,15}$/.test(id)||!Number.isInteger(p)||p<0||p>100))throw Error('各群语音比例无效');next.qqGroupVoiceRates={...rates};}
    if(input.consent===false){next.consent=false;next.qqEnabled=false;next.provider='system';}
    if(input.reference){const source=await realpath(input.reference),home=await realpath(homedir()),info=await stat(source);if(!source.startsWith(home+'/')||!source.toLowerCase().endsWith('.wav')||!info.isFile()||info.size>20*1024*1024)throw Error('请选择用户目录内、不超过20MB的WAV素材');
      if(input.consent!==true)throw Error('请确认声音素材由本人提供或已获授权');if(typeof input.transcript!=='string'||!input.transcript.trim()||input.transcript.length>2000)throw Error('请填写参考音频的准确台词');
      validateReference(await readFile(source));
      const target=join(directory,'reference.wav');if(source!==target)await copyFile(source,target);await chmod(target,0o600);next.reference=target;next.referenceLabel=typeof input.referenceLabel==='string'?input.referenceLabel.slice(0,120):basename(source);next.transcript=input.transcript.trim();next.consent=true;
    }
    if((next.provider==='clone'||next.qqEnabled)&&(!next.reference||!next.consent))throw Error('先设置声音素材和台词，再启用复刻或群聊语音');
    await saveJsonAtomic(join(directory,'settings.json'),next);settings=next;if(!next.consent||(pendingChannel.startsWith('qq')?!next.qqEnabled:next.provider!=='clone'))pending?.abort();return snapshot();
  }
  async function synthesize(text,{channel='desktop',extended=false}={}){
    const qq=channel==='qq'||channel==='qq-preview',allowed=()=>!closed&&(qq?settings.qqEnabled===true:settings.provider==='clone')&&settings.reference&&settings.consent;
    if(!allowed())throw Error('声音复刻尚未配置或语音开关已关闭');if(!await ready())throw Error('本地语音环境尚未安装');if(qq&&!await modelReady())throw Error('请先在本机准备语音模型');if(busy)throw Error('正在合成上一条语音');
    const limit=qq&&extended?500:300;if(typeof text!=='string'||!text.trim()||Array.from(text).length>limit)throw Error('单次语音需为1至'+limit+'字');busy=true;
    const id=randomUUID(),output=join(directory,id+'.wav');pending=new AbortController();pendingChannel=channel;
    try{await run(python,[script],{signal:pending.signal,timeout:qq?(extended?120000:45000):180000,maxBuffer:512*1024,env:{...process.env,TOKENIZERS_PARALLELISM:'false',OMP_NUM_THREADS:'2',HF_HOME:join(runtime,'voice-runtime/hf-cache'),HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',...await modelReady()?{HF_HUB_OFFLINE:'1'}:{},QQ_VOICE_REQUEST:JSON.stringify({text,reference:settings.reference,transcript:settings.transcript,output,max_seconds:extended?95:35})}});if(!allowed())throw Error('声音合成已取消');const info=await stat(output);if(info.size<44||info.size>20*1024*1024)throw Error('语音输出无效');await chmod(output,0o600);const old=(await Promise.all((await readdir(directory)).filter(n=>/^[a-f0-9-]{36}\.wav$/.test(n)).map(async n=>({n,at:(await stat(join(directory,n))).mtimeMs})))).sort((a,b)=>b.at-a.at);for(const item of old.slice(20))await unlink(join(directory,item.n));return {url:'/api/life/voice/audio/'+id+'.wav',id};}finally{busy=false;pending=null;}
  }
  async function audio(name){if(!/^[a-f0-9-]{36}\.wav$/.test(name))throw Error('音频编号无效');return readFile(join(directory,name));}
  async function qqAudio(name){const bytes=await audio(name),codec=createRequire(join(runtime,'voice-runtime/silk/package.json'))('silk-wasm'),result=await codec.encode(bytes,0);if(!codec.isSilk(result.data)||result.duration<=0)throw Error('QQ语音转码失败');return Buffer.from(result.data);}
  return {snapshot,update,synthesize,audio,qqAudio,cancel(){if(pendingChannel!=='qq')pending?.abort();return {cancelled:pendingChannel!=='qq'};},close(){closed=true;pending?.abort();}};
}
