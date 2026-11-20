import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openVideoNetworkGuard} from './qq-video-network.mjs';
import {createCliEnvironment} from './qq-cli-network.mjs';
import {videoError} from './qq-video-input.mjs';
const environment=createCliEnvironment();
export function createVideoContentWorker({runtime,directory,ffmpeg='/opt/homebrew/bin/ffmpeg'}={}){
  return async(source,{signal,onStage=()=>{},config={}}={})=>{
    await mkdir(join(directory,'tmp'),{recursive:true,mode:0o700});const work=await mkdtemp(join(directory,'tmp','video-'));
    const env=await environment(process.env),proxy=env.HTTPS_PROXY||env.https_proxy;
    let guard;const blocked=[];
    try{
      guard=await openVideoNetworkGuard({runtime,proxy,signal,maxBytes:(config.maxDownloadMB||96)*1024*1024+16*1024*1024,onBlocked:row=>blocked.push(row)});
      let cookieFile;
      if(config.useDedicatedCookies?.[source.platform]){cookieFile=join(runtime,'credentials',source.platform+'.cookies.txt');const st=await stat(cookieFile);if((st.mode&0o077)!==0)throw videoError('CREDENTIAL_PERMISSIONS','专用 Cookie 文件权限须为 600');}
      const request={source,work,proxy:guard.url,ffmpeg,maxBytes:(config.maxDownloadMB||96)*1024*1024,maxDurationSeconds:config.maxDurationSeconds||1800,modelDirectory:join(runtime,'models','base'),cookieFile};
      return await new Promise((resolve,reject)=>{
        const child=spawn('/usr/bin/nice',['-n','10',join(runtime,'venv','bin','python'),fileURLToPath(new URL('./qq-video-worker.py',import.meta.url))],{
          detached:true,stdio:['pipe','pipe','pipe'],env:{PATH:'/opt/homebrew/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'en_US.UTF-8',PYTHONUNBUFFERED:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',TOKENIZERS_PARALLELISM:'false',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}});
        let buffer='',result,error,size=0,stderrBytes=0;
        const kill=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}};signal.addEventListener('abort',kill,{once:true});if(signal.aborted)kill();
        child.stdout.on('data',b=>{size+=b.length;if(size>4*1024*1024){error={code:'WORKER_OUTPUT_LIMIT',message:'视频正文超过单任务上限'};kill();return;}buffer+=b.toString('utf8');let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const row=JSON.parse(line);if(row.stage)onStage(row);if(row.result)result=row.result;if(row.error)error=row.error;}catch{error={code:'WORKER_PROTOCOL',message:'视频工作进程返回了无效记录'};}}});
        child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>1024*1024)kill();});
        child.on('error',()=>reject(videoError('RUNTIME_MISSING','视频运行依赖不可用，请在本机运行 setup-video-runtime.mjs')));
        child.on('close',code=>{signal.removeEventListener('abort',kill);if(signal.aborted)return reject(videoError('CANCELLED','视频任务已取消或超时'));if(error)return reject(Object.assign(videoError(error.code,error.message),{diagnostic:error.diagnostic,networkBlocked:blocked}));if(code!==0||!result)return reject(videoError('WORKER_FAILED','视频解析工作进程未完成，没有生成总结'));resolve(result);});
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
      });
    }finally{await guard?.close();await rm(work,{recursive:true,force:true});}
  };
}
