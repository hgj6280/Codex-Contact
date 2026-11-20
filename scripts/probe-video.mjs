// Public-content probe using the exact same constrained worker as QQ jobs.
// No QQ send, no borrowed cookies, no model call.
import {homedir} from 'node:os';
import {join} from 'node:path';
import {extractVideoSources} from '../src/qq-video-input.mjs';
import {createVideoContentWorker} from '../src/qq-video-worker.mjs';
const root=join(homedir(),'Library','Application Support','CodexRemoteContact'),sources=extractVideoSources({text:process.argv[2]||''});
if(sources.length!==1)throw Error('请提供一个 BV号或支持平台的单个公开视频链接');
const source=sources[0],stages=[],started=Date.now();
try{const result=await createVideoContentWorker({runtime:join(root,'video-runtime'),directory:join(root,'data','qq-videos')})(source,{signal:AbortSignal.timeout(120000),config:{maxDurationSeconds:1800,maxDownloadMB:96},onStage:s=>stages.push(s)});console.log(JSON.stringify({...result,probe:{source,stages,durationMs:Date.now()-started}}));}
catch(e){console.log(JSON.stringify({error:{code:e.code||'PROBE_ERROR',message:e.message,diagnostic:e.diagnostic,networkBlocked:e.networkBlocked},probe:{source,stages,durationMs:Date.now()-started}}));process.exitCode=1;}
