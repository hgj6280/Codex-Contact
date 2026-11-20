import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const proxyKeys=['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy'];
export function parseSystemHttpsProxy(text){
  const field=name=>String(text).match(new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`,'m'))?.[1];
  const kind=field('HTTPSEnable')==='1'?'HTTPS':field('HTTPEnable')==='1'?'HTTP':null;
  if(!kind)return null;
  const host=field(`${kind}Proxy`),port=Number(field(`${kind}Port`));
  if(!host||!Number.isInteger(port)||port<1||port>65535||!/^[-a-zA-Z0-9.:\[\]]+$/.test(host))return null;
  return `http://${host.includes(':')&&!host.startsWith('[')?`[${host}]`:host}:${port}`;
}

// Only the owned CLI child inherits this environment. Never change process.env,
// macOS proxy settings, Gemini's local router, or the native QQ transport.
export function createCliEnvironment({platform=process.platform,now=Date.now,readSystemProxy=async()=>
  (await exec('/usr/sbin/scutil',['--proxy'],{timeout:1500,maxBuffer:32768})).stdout,ttlMs=30000}={}){
  let cached=null,expires=0,pending=null;
  async function proxy(){
    if(now()<expires)return cached;
    if(!pending)pending=Promise.resolve().then(readSystemProxy).then(parseSystemHttpsProxy,()=>null)
      .then(value=>{cached=value;expires=now()+ttlMs;return value;}).finally(()=>{pending=null;});
    return pending;
  }
  return async(env={})=>{
    if(platform!=='darwin'||proxyKeys.some(key=>env[key]))return env;
    const url=await proxy();if(!url)return env;
    const result={...env};for(const key of proxyKeys)result[key]=url;
    const bypass=[env.NO_PROXY,env.no_proxy,'localhost','127.0.0.1','::1'].filter(Boolean).join(',');
    result.NO_PROXY=result.no_proxy=bypass;
    return result;
  };
}
