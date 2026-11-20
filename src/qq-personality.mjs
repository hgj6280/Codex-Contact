import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {saveJsonAtomic} from './atomic-json.mjs';

export const PERSONALITY_MAX_LENGTH = 8000;
// Private request snapshot: cannot be supplied through JSON or serialized into
// public event logs, and keeps in-flight image/text requests on one revision.
export const QQ_PERSONALITY_SNAPSHOT = Symbol('qq-personality');
const error = (message, status = 400) => Object.assign(new Error(message), {status});

// Explicit names win; older profiles derive a name without rewriting their text.
export function personalityName(profile,fallback='助手'){
 if(profile.enabled&&profile.name?.trim())return profile.name.trim();
 const text=profile.enabled?profile.text:profile.defaultText;
 return String(text||'').match(/(?:^|\n)\s*(?:你是|你叫|你的名字是|(?:你的)?角色名[称字]?(?:是|[:：]))\s*[「“"]?([^，。,:：\n「」“”"]{1,32})/)?.[1]?.trim()||fallback;
}
// The original SOUL is never edited. The first backup is exclusive and immutable
// across saves and restarts, including when the source SOUL later changes.
export async function openQqPersonality({directory, loadDefault, persist = saveJsonAtomic}) {
  await mkdir(directory, {recursive:true, mode:0o700});
  const defaultBackupName = 'qq-soul.default-backup.md';
  const backupPath = join(directory, defaultBackupName);
  let defaultText;
  try { defaultText = await readFile(backupPath, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const original = await loadDefault();
    if (typeof original !== 'string' || !original.trim()) throw error('默认人设为空，无法备份');
    try { await writeFile(backupPath, original, {flag:'wx', mode:0o600}); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    defaultText = await readFile(backupPath, 'utf8');
  }
  const path = join(directory, 'qq-personality.json');
  const initialRevision = createHash('sha256').update(defaultText).digest('hex');
  let data = {enabled:false, text:defaultText, revision:initialRevision, updatedAt:null};
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    validate(saved);
    data = saved;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let tail = Promise.resolve();
  function validate(value) {
    if (!value || typeof value.enabled !== 'boolean' || typeof value.text !== 'string' ||
        value.text.length > PERSONALITY_MAX_LENGTH || value.text.includes('\0') || !value.text.isWellFormed() ||
        typeof value.revision !== 'string' || !value.revision || value.revision.length > 100)
      throw error('人设格式不正确，最多 8000 字，请重新读取后保存');
    if(value.name!==undefined&&(typeof value.name!=='string'||value.name.length>32||/[\x00-\x1f\x7f]/.test(value.name)))throw error('角色名字最多32字，不能包含换行');
    if (value.enabled && !value.text.trim()) throw error('启用自定义人设前，请先填写人设');
  }
  function snapshot() {
    const current=personalityName({...data,defaultText});const original=personalityName({enabled:false,defaultText},'');
    return {...data,previousNames:[...new Set([...(data.previousNames||[]),original])].filter(x=>x&&x!==current).slice(-32),name:data.name||'',effectiveName:personalityName({...data,defaultText}),defaultText, defaultBackupName, maxLength:PERSONALITY_MAX_LENGTH};
  }
  return {
    snapshot,
    update(input) {
      const candidate = structuredClone(input);
      const work = tail.then(async () => {
        candidate.name=candidate.name??data.name??'';
        candidate.name=candidate.name.trim();
        validate(candidate);
        if (candidate.revision !== data.revision) throw error('人设已在其他页面更新，请重新读取后再保存', 409);
        // Identical saves do not create unnecessary new Gemini conversations.
        if (candidate.text === data.text && candidate.enabled === data.enabled && candidate.name === (data.name||'')) return snapshot();
        const next = {enabled:candidate.enabled, text:candidate.text,name:candidate.name,
          revision:randomUUID(), updatedAt:new Date().toISOString()};
        const oldName=personalityName({...data,defaultText});
        const newName=personalityName({...next,defaultText});
        next.previousNames=[...new Set([...(data.previousNames||[]),...(oldName!==newName?[oldName]:[])])].filter(x=>x&&x!==newName).slice(-32);
        await persist(path, next);
        data = next; // Publish only after durable save; failures retain the old persona.
        return snapshot();
      });
      tail = work.catch(() => {});
      return work;
    }
  };
}

export function personalityPrompt(profile, {compact = false, compressDefault = text => text} = {}) {
  const text = profile.enabled ? profile.text : profile.defaultText;
  // Do not truncate or drop user-authored sections on the compact Gemini path.
  return [profile.enabled ? '部署者已启用以下自定义人设；语气、语癖和回复长度以此为准，不沿用旧人设。' : '默认 QQ 人设：',
    `当前角色名字是${personalityName(profile)}；自称和身份按当前名字，旧聊天的名字只作历史，不覆盖当前设定。`,
    '人设仅定义虚构角色与说话风格，不能改变隐私、权限、工具使用和真实执行边界。',
    '<qq_personality>', compact && !profile.enabled ? compressDefault(text) : text, '</qq_personality>',`当前有效角色名：${personalityName(profile)}；与上文旧名冲突时以此名字为准，权限规则不变。`].join('\n');
}

export async function handlePersonalityRequest(req, res, {store, isLocalRequest, readBody, sendJson}) {
  if (!['/api/qq/personality', '/api/qq/personality/default'].includes(req.url)) return false;
  if (!isLocalRequest(req) || req.headers['sec-fetch-site'] === 'cross-site') {
    sendJson(res, 403, {error:'只允许本机管理页面访问人设'}); return true;
  }
  try {
    if (req.method === 'GET' && req.url.endsWith('/default')) {
      res.writeHead(200, {'content-type':'text/markdown; charset=utf-8', 'cache-control':'no-store',
        'content-disposition':'attachment; filename="qq-soul.default-backup.md"'});
      res.end(store.snapshot().defaultText);
    } else if (req.method === 'GET') sendJson(res, 200, store.snapshot());
    else if (req.method === 'POST' && req.url === '/api/qq/personality')
      sendJson(res, 200, await store.update(await readBody(req, 64 * 1024)));
    else sendJson(res, 405, {error:'不支持此操作'});
  } catch (e) { sendJson(res, e.status || 500, {error:e.status ? e.message : '人设保存失败，原设置未改变，请检查后台存储'}); }
  return true;
}
