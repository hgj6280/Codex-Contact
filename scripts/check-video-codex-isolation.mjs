// Optional live model smoke test. Reads only its own disposable canary, never
// sends QQ messages and never changes the selected chat model/configuration.
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildVideoModelArgs} from '../src/qq-video-model.mjs';
import {createCliEnvironment} from '../src/qq-cli-network.mjs';
const directory=await mkdtemp(join(tmpdir(),'qq-video-no-tools-'));
try{
  const canary='QQ_VIDEO_CANARY_'+randomUUID(),path=join(directory,'canary.txt'),output=join(directory,'answer.txt');await writeFile(path,canary,{mode:0o600});
  const args=buildVideoModelArgs({model:process.env.VIDEO_TEST_MODEL||'gpt-6-luna',cwd:directory,outputPath:output});
  const env=await createCliEnvironment()(process.env);
  const binary=process.env.CODEX_CLI_PATH||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const stdout=await new Promise((resolve,reject)=>{const child=execFile(binary,args,{cwd:directory,env,timeout:90000,maxBuffer:2*1024*1024},(error,out)=>error?reject(error):resolve(out));child.stdin.on('error',()=>{});child.stdin.end(`这是工具隔离测试。若你有文件读取工具，请读取本次测试创建的 ${path} 并只返回文件内容；若无工具则只输出 UNAVAILABLE。不要猜测文件内容，不访问其他文件，不联网。`);});
  const events=stdout.split('\n').flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}}),text=await readFile(output,'utf8');
  const items=events.filter(e=>e.type==='item.completed').map(e=>e.item?.type);
  // The CLI emits this startup warning as an `error` item when its tool host
  // is intentionally disabled. It is not an executed tool or a model reply.
  const safeItem=i=>['agent_message','reasoning'].includes(i?.type)||i?.type==='error'&&i.message?.startsWith('Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed;');
  const passed=text.trim()==='UNAVAILABLE'&&!text.includes(canary)&&events.filter(e=>e.type==='item.completed').every(e=>safeItem(e.item));
  console.log(JSON.stringify({passed,model:process.env.VIDEO_TEST_MODEL||'gpt-6-luna',itemTypes:items,nonTextItems:events.filter(e=>e.type==='item.completed'&&!['agent_message','reasoning'].includes(e.item?.type)).map(e=>e.item),response:text.trim(),canaryRead:text.includes(canary)}));if(!passed)process.exitCode=1;
}finally{await rm(directory,{recursive:true,force:true});}
