import { realpath, readFile, stat, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import { request } from 'node:https';
import { lookup } from 'node:dns';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {safeImageError} from './qq-image-preflight.mjs';
import {filterStickerCatalog,filterStickerMedia,isStickerDisabled} from './qq-sticker-policy.mjs';

const execFileAsync = promisify(execFile);
const MODEL_IMAGE_LIMIT = 5 * 1024 * 1024;
const DOWNLOAD_IMAGE_LIMIT = 20 * 1024 * 1024;

const marker = /\[\[qq_image:([^\]\r\n]+)\]\]/g;
export function stripImageMarkers(text) {
  return String(text || '').replace(marker, '').replace(/\[\[qq_sticker:[^\]\r\n]+\]\]/g, '').trim();
}
export async function resolveImages(text, { stickerDir } = {}) {
  const paths = [...String(text || '').matchAll(marker)].map(m => m[1].trim());
  const stickers = [...String(text || '').matchAll(/\[\[qq_sticker:([^\]\r\n]+)\]\]/g)];
  if (stickers.length > 1) throw new Error('At most one sticker per reply');
  if (stickers.length) {
    const catalog = await stickerCatalog(stickerDir);
    const found = catalog.find(s => s.name === stickers[0][1].trim());
    if (!found && !await isStickerDisabled(stickers[0][1].trim(),stickerDir)) throw new Error('Sticker not found in local catalog');
    if(found)paths.push(found.path);
  }
  if (paths.length > 3) throw new Error('At most three QQ images per reply');
  return filterStickerMedia([...new Set(paths)],stickerDir);
}
export async function stickerCatalog(dir) {
  if (!dir) return [];
  const entries = await readdir(dir, {withFileTypes:true}).catch(e => { if(e.code === 'ENOENT') return []; throw e; });
  return filterStickerCatalog(entries.filter(e => e.isFile() && /\.(png|jpe?g|gif|webp)$/i.test(e.name)
      && !/^(?:oc|qq)-\d{3,}\./i.test(e.name))
    .sort((a,b) => a.name.localeCompare(b.name))
    .map(e => ({name:e.name, path:resolve(dir,e.name)})),dir);
}
export function extractImages(payload) {
  return (Array.isArray(payload.message) ? payload.message : [])
    .filter(s => s.type === 'image').map(s => ({file:s.data?.file, url:s.data?.url}));
}
export function normalizeQqImageUrl(raw) {
  const url=new URL(raw);
  const trusted=['multimedia.nt.qq.com.cn','gchat.qpic.cn','c2cpicdw.qpic.cn'];
  if(url.protocol==='http:'&&trusted.includes(url.hostname)&&!url.username&&!url.password&&(!url.port||url.port==='80')){url.protocol='https:';url.port='';}
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!trusted.includes(url.hostname))throw new Error('QQ image URL host is not permitted');
  return url;
}
export function downloadImage(raw) {
  const url = normalizeQqImageUrl(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !['multimedia.nt.qq.com.cn','gchat.qpic.cn','c2cpicdw.qpic.cn'].includes(url.hostname))
    throw new Error('QQ image URL host is not permitted');
  return new Promise((resolveDownload,reject) => {
    const req = request(url, { lookup(host, options, callback) {
      lookup(host,{family:4},async (err,address,family) => {
        if(err) return callback(err);
        // Only these fixed QQ CDN hosts reach this lookup. Resolve fake-IP via
        // HTTPS DNS, then still validate and pin the actual connection address.
        if (/^198\.(18|19)\./.test(address)) {
          try {
            const response = await fetch(`https://dns.alidns.com/resolve?name=${encodeURIComponent(host)}&type=A`, {
              headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(5000)
            });
            const answer = await response.json();
            address = answer.Answer?.find(a => a.type === 1)?.data;
            if (!address || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) throw new Error('No public QQ image address');
          } catch { callback(new Error('QQ image DNS resolution failed')); return; }
        }
        const [a,b] = address.split('.').map(Number);
        if(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) ||
          (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)))
          return callback(new Error('Private image destination blocked'));
        callback(null, options.all ? [{address,family}] : address, family);
      });
    }}, res => {
      if(res.statusCode !== 200) {res.resume();reject(new Error(`QQ image download failed (HTTP ${res.statusCode})`));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>DOWNLOAD_IMAGE_LIMIT)req.destroy(new Error('QQ image exceeds 20 MiB download limit'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>resolveDownload(Buffer.concat(chunks)));
    });
    const timer=setTimeout(()=>req.destroy(new Error('QQ image download timed out')),15000);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
  });
}
function imageExtension(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return '.jpg';
  if (['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())) return '.gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return '.webp';
  throw new Error('Unsupported QQ image content');
}
async function fitImageForModel(source, target) {
  for (const [maxDimension, quality] of [[3072,88],[2560,84],[2048,78]]) {
    await execFileAsync('/usr/bin/sips', [
      '-s','format','jpeg','-s','formatOptions',String(quality),'-Z',String(maxDimension),source,'--out',target
    ], { timeout: 30000 });
    if ((await stat(target)).size <= MODEL_IMAGE_LIMIT) return;
  }
  throw new Error('QQ image could not be reduced below 5 MiB');
}
// Generation-only recovery. Keep normal chat image preparation unchanged.
export async function downloadGenerationReference(input,{fetchOneBotImage,download=downloadImage,onAttempt=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  let url=input.url;
  for(let attempt=1;attempt<=3;attempt++) {
    try {
      if(!url&&input.file)url=(await fetchOneBotImage(input.file)).url;
      if(!url)throw new Error('No downloadable QQ image URL');
      const bytes=await download(url);
      onAttempt({attempt,status:'completed'});
      return bytes;
    } catch(error) {
      const retryable=/download failed(?: \(HTTP (?:403|404|408|429|5\d\d)\))?$|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|tls handshake eof|QQ image DNS resolution failed/i.test(error.message);
      onAttempt({attempt,status:'failed',error:safeImageError(error)});
      if(!retryable||attempt===3)throw error;
      // A refreshed URL may legitimately be unchanged: transient failures can
      // recover on the same CDN URL. Host/IP/size validation is never bypassed.
      if(input.file&&fetchOneBotImage)try {url=(await fetchOneBotImage(input.file)).url||url;}
      catch(refreshError){onAttempt({attempt,status:'refresh-failed',error:safeImageError(refreshError)});}
      await wait(attempt===1?750:1500);
    }
  }
}

export async function prepareImages(images,{outputDir,fetchOneBotImage,onError = () => {},download = downloadImage,retryTransient=false,onAttempt=()=>{}}) {
  await mkdir(outputDir,{recursive:true,mode:0o700});
  const paths=[];
  for(const [index,input] of images.slice(0,3).entries()) {
    const created=[];
    try {
      let bytes;
      if(retryTransient)bytes=await downloadGenerationReference(input,{fetchOneBotImage,download,
        onAttempt:row=>onAttempt({referenceIndex:index+1,source:input.referenceSource||'当前图片',...row})});
      else {
        let url=input.url;
        if(!url && input.file) url=(await fetchOneBotImage(input.file)).url;
        if(!url) throw new Error('No downloadable QQ image URL');
        try { bytes=await download(url); }
        catch (error) {
          // Normal chat retains its original one-refresh behavior.
          if (!input.file || !fetchOneBotImage || !/download failed|timed out|ENOTFOUND|ECONNRESET/.test(error.message)) throw error;
          const fresh=(await fetchOneBotImage(input.file)).url;
          if (!fresh || fresh === url) throw error;
          bytes=await download(fresh);
        }
      }
      if (bytes.length > DOWNLOAD_IMAGE_LIMIT) throw new Error('QQ image exceeds 20 MiB download limit');
      const extension=imageExtension(bytes);
      const stem=resolve(outputDir,randomUUID());
      const original=stem+extension;
      await writeFile(original,bytes,{mode:0o600});
      created.push(original);
      let path=original;
      // Both OCR and CLI see the same first frame rather than a multi-frame GIF.
      if (extension === '.gif') {
        path=stem+'-frame.png'; created.push(path);
        await execFileAsync('/usr/bin/sips', ['-s','format','png',original,'--out',path], {timeout:30000});
      }
      if ((await stat(path)).size > MODEL_IMAGE_LIMIT) {
        const source = path;
        path=stem+'-model.jpg'; created.push(path);
        await fitImageForModel(source,path);
      }
      if (path !== original) {
        await unlink(original);
        created.shift();
      }
      for (const intermediate of created.filter(file => file !== path)) await unlink(intermediate);
      await imageSegment(path,[outputDir]);
      paths.push(path);
    } catch (error) {
      await Promise.all(created.map(path=>unlink(path).catch(()=>{})));
      onError(error.message);
    }
  }
  return paths;
}
export async function imageSegment(path, roots) {
  const canonical = await realpath(path);
  let allowed = false;
  for (const root of roots) {
    const base = await realpath(resolve(root)).catch(() => null);
    if (base && canonical.startsWith(base + sep)) allowed = true;
  }
  if (!allowed) throw new Error('QQ image path is outside permitted image directories');
  const info = await stat(canonical);
  if (!info.isFile() || info.size > MODEL_IMAGE_LIMIT) throw new Error('QQ image must be a file of at most 5 MiB');
  const bytes = await readFile(canonical);
  imageExtension(bytes);
  return { type: 'image', data: { file: `base64://${bytes.toString('base64')}` } };
}
