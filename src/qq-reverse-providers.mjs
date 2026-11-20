import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createCliEnvironment} from './qq-cli-network.mjs';
const engineHosts=new Set(['saucenao.com','www.saucenao.com','ascii2d.net','lens.google.com','www.google.com','google.com']);
const clean=s=>String(s||'').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
export function publicSourceUrl(value){
  try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.href.length>2500)return null;
    const h=u.hostname.toLowerCase();if(!h.includes('.')||h==='localhost'||/^\d+(?:\.\d+){3}$/.test(h)||h.includes(':')||/\.(?:local|localhost|internal)$/.test(h)||engineHosts.has(h)||/(?:^|\.)qpic\.cn$|(?:^|\.)qq\.com$/.test(h))return null;
    if(/(?:^|\.)pixiv\.net$/.test(h)&&u.searchParams.has('illust_id'))return 'https://www.pixiv.net/artworks/'+u.searchParams.get('illust_id').replace(/\D/g,'');
    u.hash='';for(const k of [...u.searchParams.keys()])if(/^(?:utm_|token|auth|rkey)/i.test(k))u.searchParams.delete(k);return u.href;
  }catch{return null;}
}
function authorUrl(url){const u=new URL(url);return /(?:^|\.)pixiv\.net$/.test(u.hostname)&&/^\/users\/\d+/.test(u.pathname)||/^(?:www\.)?(?:twitter\.com|x\.com)$/.test(u.hostname)&&/^\/[^/]+\/?$/.test(u.pathname)||/^(?:www\.)?deviantart\.com$/.test(u.hostname)&&/^\/[^/]+\/?$/.test(u.pathname);}
function postRank(url){return /pixiv\.net\/artworks|(?:twitter|x)\.com\/[^/]+\/status|artstation\.com\/artwork/.test(url)?0:/danbooru|gelbooru|yande\.re/.test(url)?2:1;}
export function parseSourceResults(engine,html,load){
  const $=load(html),body=clean($('body').text());
  if(/cf-chl|challenge-platform|captcha|Enable JavaScript and cookies|Just a moment/i.test(html))return {status:'challenge',reason:'需要网页人机验证',candidates:[]};
  if(/daily search limit|search limit exceeded|too many requests|rate.?limit/i.test(body))return {status:'limited',reason:'免费查询额度或频率限制',candidates:[]};
  const candidates=[];
  if(engine==='saucenao')$('.result').each((_,el)=>{
    const box=$(el),similarity=Number.parseFloat(box.find('.resultsimilarityinfo').text());if(!Number.isFinite(similarity)||similarity<80)return;
    const links=[...new Set(box.find('.resultcontent a[href]').map((_,a)=>publicSourceUrl($(a).attr('href'))).get().filter(Boolean))];
    const posts=links.filter(x=>!authorUrl(x)).sort((a,b)=>postRank(a)-postRank(b));if(!posts.length)return;
    const content=box.find('.resultcontent').clone();content.find('br').replaceWith('\n');const text=content.text();
    const name=clean(text.match(/(?:Creator(?:\(s\))?|Artist(?:\(s\))?|Author(?:\(s\))?|Member)\s*:\s*([^\n]+)/i)?.[1]);
    candidates.push({engine,title:clean(box.find('.resulttitle').text())||'图片来源候选',publisher:name||null,accountUrl:links.find(authorUrl)||null,postUrl:posts[0],indexUrl:posts.find(x=>x!==posts[0])||null,similarity});
  });
  if(engine==='ascii2d')$('.item-box').each((_,el)=>{const box=$(el).find('.detail-box'),links=box.find('h6 a[href]').map((_,a)=>({url:publicSourceUrl($(a).attr('href')),label:clean($(a).text())})).get().filter(x=>x.url);if(!links.length)return;
    const post=links.find(x=>!authorUrl(x.url));if(!post)return;const account=links.find(x=>authorUrl(x.url));candidates.push({engine,title:post.label||'图片来源候选',publisher:account?.label||null,accountUrl:account?.url||null,postUrl:post.url,similarity:null});
  });
  const seen=new Set();return {status:candidates.length?'matched':'no_match',candidates:candidates.filter(x=>{if(seen.has(x.postUrl))return false;seen.add(x.postUrl);return true;}).slice(0,3)};
}
export function createReverseProviders({runtime,environment=createCliEnvironment(),now=Date.now}={}){
  const require=createRequire(join(runtime,'image-search-runtime/package.json')),{load}=require('cheerio'),{fetch,ProxyAgent,FormData}=require('undici');
  let proxy=null,dispatcher=null;const sessions=new Map();
  async function request(raw,options={},signal){
    let url=new URL(raw),method=options.method||'GET',body=options.body;const env=await environment(process.env),nextProxy=env.HTTPS_PROXY||env.https_proxy||null;
    if(nextProxy!==proxy){if(dispatcher)await dispatcher.close();proxy=nextProxy;dispatcher=proxy?new ProxyAgent(proxy):null;}
    for(let i=0;i<4;i++){
      if(url.protocol!=='https:'||url.port||url.username||url.password||!engineHosts.has(url.hostname))throw Error('搜索服务返回了不支持的跳转');
      const cookie=sessions.get(url.hostname)||'',headers={'user-agent':'Mozilla/5.0 CodexRemoteContact/1.0',...options.headers,...cookie?{cookie}:{}};
      const response=await fetch(url,{method,body,headers,redirect:'manual',dispatcher:dispatcher||undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
      const cookies=response.headers.getSetCookie().map(s=>s.split(';')[0]);if(cookies.length)sessions.set(url.hostname,[...cookie.split('; ').filter(Boolean),...cookies].join('; '));
      if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get('location'),url);if(response.status===303||([301,302].includes(response.status)&&method==='POST')){method='GET';body=undefined;}continue;}
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>3*1024*1024)throw Error('搜索结果过大');chunks.push(chunk);}return {status:response.status,url:url.href,html:Buffer.concat(chunks).toString('utf8')};
    }throw Error('搜索服务跳转过多');
  }
  async function query(engine,bytes,signal){
    const form=new FormData();form.set(engine==='lens'?'encoded_image':'file',new Blob([bytes],{type:'image/jpeg'}),'image.jpg');
    let url='https://saucenao.com/search.php';
    if(engine==='saucenao'){form.set('db','999');form.set('numres','5');form.set('hide','1');}
    if(engine==='ascii2d'){const home=await request('https://ascii2d.net/',{},signal);const challenge=parseSourceResults(engine,home.html,load);if(home.status!==200||challenge.status==='challenge')return {...challenge,status:home.status===429?'limited':challenge.status==='challenge'?'challenge':'unavailable'};const token=load(home.html)('#file_upload input[name=authenticity_token]').attr('value');if(!token)throw Error('搜索网页格式已变更');form.set('utf8','✓');form.set('authenticity_token',token);url='https://ascii2d.net/search/file';}
    if(engine==='lens')url='https://lens.google.com/v3/upload';
    const result=await request(url,{method:'POST',body:form},signal);
    if(result.status===429)return {status:'limited',reason:'免费查询频率限制',candidates:[]};
    const parsed=parseSourceResults(engine,result.html,load);
    if(result.status!==200)return {...parsed,status:parsed.status==='challenge'?'challenge':'unavailable',reason:parsed.reason||'服务暂时不可用'};
    if(engine==='lens')return {status:'link',candidates:[],lookupUrl:result.url.startsWith('https://www.google.com/search?')?result.url:null,reason:'Lens 结果需在网页查看'};
    return parsed;
  }
  return {async search(bytes,{blocked=()=>false,allowed=()=>true,onProvider=()=>{},signal=AbortSignal.timeout(48000)}={}){
    const outcomes=[],candidates=[];let lookupUrl=null;
    for(const engine of ['saucenao','ascii2d','lens']){
      if(blocked(engine)){outcomes.push({engine,status:'cooldown',reason:'服务冷却中'});continue;}
      if(signal.aborted||!allowed())break;let result;
      try{result=await query(engine,bytes,signal);}catch(e){result={status:'unavailable',reason:signal.aborted?'查询超时':'网络暂时不可用',candidates:[]};}
      const {candidates:rows=[],lookupUrl:link,...brief}=result;outcomes.push({engine,...brief});await onProvider(engine,brief);candidates.push(...rows);if(link)lookupUrl=link;
      // Strong SauceNAO matches already supply original posts; avoid needless uploads.
      if(rows.some(r=>r.similarity>=85)||engine==='ascii2d'&&rows.length)break;
    }
    return {candidates:candidates.slice(0,3),outcomes,lookupUrl,at:now()};
  },async close(){await dispatcher?.close();}};
}
