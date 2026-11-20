import { mkdir, readFile, writeFile, appendFile, copyFile, stat, realpath, readdir } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultArchiveMetadataDir = fileURLToPath(new URL('../data/qq-image-archive/', import.meta.url));

export const archiveReadme = 'AI 群友生成的图片自动保存到此处。\n所有未压缩原图直接平铺在当前文件夹，不再按日期或会话建图片文件夹。\n生成记录文件夹保存每次请求的说明和记录；生成索引.jsonl 可用于统一检索。\n记录包含请求文字、来源群/私聊及发起人，仅保存在本机，不发到 QQ。\n归档不代表 QQ 已成功收到图片；QQ 发送结果请看控制面板。\n';

export function archiveImageName(threadId, index, sourcePath) {
  return `${threadId}-${String(index + 1).padStart(2, '0')}-${basename(sourcePath)}`;
}

async function checksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Content matching is opt-in for historical backfills: user-renamed pictures
// remain where they are, without recreating the old filename or changing them.
export async function indexArchivedImages(directory) {
  const index = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    if (entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name)) {
      const hash = await checksum(join(directory, entry.name));
      if (!index.has(hash)) index.set(hash, entry.name);
    }
  }
  return index;
}

// A full disk or unavailable Downloads folder must not turn successful image
// generation into a failed reply (or trigger a second paid generation).
export async function archiveQqImagesSafely(options) {
  try { return await archiveQqImages(options); }
  catch (error) { return { ok: false, directory: options.directory, error: error.message, sourceFiles: options.files }; }
}

export async function archiveQqImages({ directory, metadataDirectory = defaultArchiveMetadataDir, sourceRoot, threadId, files, context = {}, existingImagesByChecksum }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) throw new Error('Invalid image session id');
  if (!files.length) return null;
  const root = await realpath(sourceRoot);
  const sources = [];
  for (const file of files) {
    const canonical = await realpath(file);
    if (!canonical.startsWith(join(root, threadId) + sep)) throw new Error('Image archive source is outside this session');
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error('Image archive source is not a file');
    sources.push({ path: canonical, info });
  }
  const generatedAt = new Date(Math.min(...sources.map(s => s.info.mtimeMs)));
  const folder = directory;
  const recordsDir = join(metadataDirectory, '生成记录');
  const recordPath = join(recordsDir, `${threadId}.json`);
  const existing = await readFile(recordPath, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing) {
    for (const image of existing.images) {
      if (image.name !== basename(image.name)) throw new Error('Invalid archived image name');
      const hash = await checksum(join(folder, image.name)).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      const renamed = existingImagesByChecksum?.get(image.sha256);
      if (hash !== image.sha256 && !(hash === null && renamed === basename(renamed || '') && renamed && await checksum(join(folder, renamed)) === image.sha256)) throw new Error('Archived image checksum mismatch');
    }
    return { ok: true, directory: folder, recordPath, count: existing.images.length, copied: 0, reused: existing.images.length, alreadyArchived: true };
  }
  await mkdir(recordsDir, { recursive: true, mode: 0o700 });
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const images = [];
  let copied = 0, reused = 0;
  for (const [i, source] of sources.entries()) {
    const sha256 = await checksum(source.path);
    const matched = existingImagesByChecksum?.get(sha256);
    if (matched && matched !== basename(matched)) throw new Error('Invalid archived image name');
    const name = matched || archiveImageName(threadId, i, source.path);
    const destination = join(folder, name);
    if (matched) reused++;
    else {
      try { await copyFile(source.path, destination, constants.COPYFILE_EXCL); copied++; }
      catch (e) { if (e.code !== 'EEXIST') throw e; reused++; }
    }
    if (await checksum(destination) !== sha256) throw new Error('Image archive copy verification failed');
    existingImagesByChecksum?.set(sha256, name);
    images.push({ name, bytes: source.info.size, sha256, originalPath: source.path });
  }
  const record = { version: 2, layout: 'flat', threadId, generatedAt: generatedAt.toISOString(), archivedAt: new Date().toISOString(), context, images };
  const description = [
    'AI 群友生图记录',
    `生成时间：${generatedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`,
    `来源：${context.type === 'private_message' ? '私聊' : '群聊'} ${context.groupId || context.senderId || '未知'}`,
    `发起人：${context.senderLabel || ''} ${context.senderId || ''}`,
    `模型：${context.model || '历史记录未保留'}`,
    `生图要求：${context.request || '历史记录未保留'}`,
    context.quotedText ? `引用内容：${context.quotedText}` : '',
    context.backfilled ? '说明：从已有 QQ 生图记录补存；模型等未保留的信息不作推测。' : '',
    '', '文件（保留生成原图）：', ...images.map(i => i.name), ''
  ].filter(line => line !== '').join('\n');
  await writeFile(join(recordsDir, `${threadId}.txt`), description, { flag: 'wx', mode: 0o600 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await appendFile(join(metadataDirectory, '生成索引.jsonl'), JSON.stringify({ ...record, imageDirectory: folder, recordPath: relative(metadataDirectory, recordPath) }) + '\n', { mode: 0o600 });
  return { ok: true, directory: folder, recordPath, count: images.length, copied, reused, alreadyArchived: false };
}
