// Run with the archive writer paused; preserves originals and backs up old metadata.
import { readdir, readFile, writeFile, mkdir, copyFile, unlink, rmdir, lstat, rename } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { archiveImageName, archiveReadme } from '../src/qq-image-archive.mjs';

async function hash(path) {
  if (!(await lstat(path)).isFile()) throw new Error(`Not a regular file: ${path}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function copyVerified(source, destination, expected) {
  const digest = await hash(source);
  if (expected && digest !== expected) throw new Error(`Source checksum mismatch: ${source}`);
  await copyFile(source, destination, constants.COPYFILE_EXCL).catch(e => { if (e.code !== 'EEXIST') throw e; });
  if (await hash(destination) !== digest) throw new Error(`Destination collision or checksum mismatch: ${destination}`);
}
async function writeExclusive(path, content) {
  await writeFile(path, content, { flag: 'wx', mode: 0o600 }).catch(async e => {
    if (e.code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw e;
  });
}
async function removeEmpty(path) {
  await rmdir(path).catch(e => { if (!['ENOENT', 'ENOTEMPTY'].includes(e.code)) throw e; });
}

export async function flattenArchive(directory) {
  directory = resolve(directory);
  const recordsDir = join(directory, '生成记录');
  const backupDir = join(recordsDir, '旧布局记录备份');
  const sessions = [];
  const dates = [];
  for (const date of await readdir(directory, { withFileTypes: true })) {
    if (!date.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(date.name)) continue;
    const dateDir = join(directory, date.name);
    dates.push(dateDir);
    for (const entry of await readdir(dateDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.name)) continue;
      const folder = join(dateDir, entry.name);
      const record = await readFile(join(folder, '生成记录.json'), 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (!record) continue;
      if (record.threadId !== entry.name) throw new Error('Record session mismatch');
      const images = record.images.map((image, i) => {
        if (!image.name || image.name !== basename(image.name)) throw new Error('Invalid image name');
        return { ...image, name: archiveImageName(record.threadId, i, image.originalPath || image.name.replace(/^\d+-/, '')) };
      });
      sessions.push({ folder, record, flat: { ...record, version: 2, layout: 'flat', images } });
    }
  }
  if (!sessions.length) return { sessions: 0, images: 0, directory };
  // Check all source files before changing the layout. A retry may find an image already moved.
  for (const session of sessions) {
    for (const [i, image] of session.record.images.entries()) {
      const source = join(session.folder, image.name);
      const digest = await hash(source).catch(e => {
        if (e.code === 'ENOENT') return hash(join(directory, session.flat.images[i].name));
        throw e;
      });
      if (digest !== image.sha256) throw new Error(`Source checksum mismatch: ${source}`);
    }
  }
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  for (const name of ['生成索引.jsonl', '使用说明.txt']) {
    const destination = join(backupDir, name);
    if (await lstat(destination).catch(e => { if (e.code === 'ENOENT') return null; throw e; })) continue;
    await copyVerified(join(directory, name), destination).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
  for (const session of sessions) {
    const { record, flat, folder } = session;
    for (const [i, image] of record.images.entries()) {
      const source = join(folder, image.name);
      const destination = join(directory, flat.images[i].name);
      await copyVerified(source, destination, image.sha256).catch(async e => {
        if (e.code !== 'ENOENT' || await hash(destination) !== image.sha256) throw e;
      });
    }
    await copyVerified(join(folder, '生成记录.json'), join(backupDir, `${record.threadId}.json`));
    const descriptionPath = join(folder, '生成说明.txt');
    let description = await readFile(descriptionPath, 'utf8');
    await copyVerified(descriptionPath, join(backupDir, `${record.threadId}.txt`));
    for (const [i, image] of record.images.entries()) description = description.split(image.name).join(flat.images[i].name);
    await writeExclusive(join(recordsDir, `${record.threadId}.txt`), description);
    await writeExclusive(join(recordsDir, `${record.threadId}.json`), JSON.stringify(flat, null, 2) + '\n');
  }
  // Rebuild from current manifests, including any already-flat sessions; old index is backed up.
  const lines = [];
  for (const entry of await readdir(recordsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const recordPath = join(recordsDir, entry.name);
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    lines.push(JSON.stringify({ ...record, recordPath: relative(directory, recordPath) }));
  }
  const indexTemp = join(recordsDir, '迁移索引.tmp');
  await writeFile(indexTemp, lines.join('\n') + '\n', { mode: 0o600 });
  await rename(indexTemp, join(directory, '生成索引.jsonl'));
  await writeFile(join(directory, '使用说明.txt'), archiveReadme, { mode: 0o600 });
  // Remove only verified duplicate copies; keep unknown files and never recursively delete.
  for (const session of sessions) {
    for (const [i, image] of session.record.images.entries()) {
      if (await hash(join(directory, session.flat.images[i].name)) !== image.sha256) throw new Error('Final verification failed');
      await unlink(join(session.folder, image.name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
    for (const name of ['生成记录.json', '生成说明.txt']) {
      await unlink(join(session.folder, name));
    }
    const finderFile = join(session.folder, '.DS_Store');
    await copyVerified(finderFile, join(backupDir, `${session.record.threadId}.DS_Store`)).then(() => unlink(finderFile)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await removeEmpty(session.folder);
  }
  for (const dateDir of dates) {
    const finderFile = join(dateDir, '.DS_Store');
    await copyVerified(finderFile, join(backupDir, `${basename(dateDir)}.DS_Store`)).then(() => unlink(finderFile)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await removeEmpty(dateDir);
  }
  return { directory, sessions: sessions.length, images: sessions.reduce((sum, s) => sum + s.flat.images.length, 0), backupDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Pass the exact archive directory; pause the writer before migrating.');
  console.log(JSON.stringify(await flattenArchive(process.argv[2])));
}
