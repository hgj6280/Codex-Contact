import {createServer,request,Agent} from 'node:http';
import {connect} from 'node:net';
import {lookup} from 'node:dns/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';

const suffixes=['bilibili.com','biliapi.net','biliapi.com','bilivideo.com','bilivideo.cn','bilivideo.net','b23.tv','hdslb.com','akamaized.net','douyin.com','iesdouyin.com','amemv.com','douyinvod.com','bytecdn.cn','byteimg.com','douyinpic.com','snssdk.com','ibytedtos.com','bytedance.com','youtube.com','youtu.be','googlevideo.com','ytimg.com','google.com','googleapis.com','ggpht.com','googleusercontent.com'];
export function allowedVideoHost(host){return /^[a-z0-9.-]+$/.test(host)&&suffixes.some(s=>host===s||host.endsWith('.'+s));}
export function publicVideoIPv4(ip){
  const n=ip.split('.').map(Number);if(n.length!==4||n.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const [a,b]=n;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===198&&b===51||a===203&&b===0);
}
export async function openVideoNetworkGuard({runtime,proxy,maxBytes=100*1024*1024,signal,resolve=lookup,onBlocked=()=>{}}){
  const require=createRequire(join(runtime,'package.json')),{fetch,ProxyAgent}=require('undici'),dispatcher=proxy?new ProxyAgent(proxy):undefined;
  const sockets=new Set(),cache=new Map();let received=0;
  async function address(host){
    if(!allowedVideoHost(host)){onBlocked({host,reason:'host-not-allowed'});throw Error('VIDEO_NETWORK_BLOCKED');}if(cache.has(host))return cache.get(host);
    let answers=await resolve(host,{all:true,family:4}).catch(()=>[]);
    if(answers.some(x=>/^198\.(?:18|19)\./.test(x.address))||!answers.length){
      const r=await fetch('https://dns.alidns.com/resolve?type=A&name='+encodeURIComponent(host),{dispatcher,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
      const data=await r.json();answers=(data.Answer||[]).filter(a=>a.type===1).map(a=>({address:a.data}));
    }
    if(!answers.length||answers.some(a=>!publicVideoIPv4(a.address))){onBlocked({host,reason:'non-public-or-missing-address'});throw Error('VIDEO_NETWORK_BLOCKED');}cache.set(host,answers[0].address);return answers[0].address;
  }
  function track(socket){sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));return socket;}
  async function tunnel(host,port){
    if(![80,443].includes(port))throw Error('VIDEO_NETWORK_BLOCKED');const ip=await address(host);
    const socket=await new Promise((resolve,reject)=>{
      if(proxy){const p=new URL(proxy);if(p.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(p.hostname)){reject(Error('VIDEO_PROXY_CONFIG'));return;}
        const req=request({hostname:p.hostname,port:p.port||80,method:'CONNECT',path:`${ip}:${port}`,headers:{host:`${ip}:${port}`},timeout:12000,agent:false,signal});req.on('connect',(r,s,head)=>{if(r.statusCode!==200){s.destroy();reject(Error('VIDEO_PROXY_UNAVAILABLE'));return;}if(head.length)s.unshift(head);resolve(track(s));});req.on('timeout',()=>req.destroy(Error('VIDEO_PROXY_TIMEOUT')));req.on('error',reject);req.end();
      }else{const s=track(connect({host:ip,port}));s.once('connect',()=>resolve(s));s.once('error',reject);s.setTimeout(12000,()=>s.destroy(Error('VIDEO_CONNECT_TIMEOUT')));}
    });
    socket.on('data',b=>{received+=b.length;if(received>maxBytes)for(const s of sockets)s.destroy();});return socket;
  }
  const server=createServer(async(req,res)=>{
    try{const u=new URL(req.url);if(u.protocol!=='http:'||u.username||u.password||u.port&&u.port!=='80')throw Error('VIDEO_NETWORK_BLOCKED');const s=await tunnel(u.hostname,80);
      const agent=new Agent({keepAlive:false});agent.createConnection=()=>s;
      const upstream=request({hostname:u.hostname,path:u.pathname+u.search,method:'GET',headers:{host:u.hostname,connection:'close','user-agent':req.headers['user-agent']||'qq-video'},agent,signal},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>res.destroy());upstream.on('close',()=>agent.destroy());upstream.end();
    }catch(error){onBlocked({host:URL.canParse(req.url)?new URL(req.url).hostname:'invalid',reason:error.code||error.message});res.writeHead(403);res.end('Video network policy blocked request');}
  });
  server.on('connection',track);
  server.on('connect',async(req,client,head)=>{
    track(client);try{const target=new URL('https://'+req.url);if(target.username||target.password||target.pathname!=='/'||target.port&&target.port!=='443')throw Error('BLOCKED');const s=await tunnel(target.hostname,443);client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)s.write(head);client.pipe(s);s.pipe(client);client.on('close',()=>s.destroy());s.on('close',()=>client.destroy());}catch(error){onBlocked({host:req.url.split(':')[0],reason:error.code||error.message});client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const close=async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));await dispatcher?.close();};signal.addEventListener('abort',()=>{for(const s of sockets)s.destroy();},{once:true});
  return {url:`http://127.0.0.1:${server.address().port}`,close,bytes:()=>received};
}
