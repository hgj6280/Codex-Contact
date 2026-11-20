import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, stat, realpath, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexImageTracker, generatedImageReply } from './qq-codex-images.mjs';
import { resolveImages, imageSegment } from './qq-media.mjs';
import { flattenArchive } from '../scripts/flatten-qq-image-archive.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'qq-codex-images-test-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, 'generated_images', id, 'nested'), { recursive: true });
  await mkdir(join(home, 'generated_images', otherId), { recursive: true });
  return home;
}
function track(home, threadId = id, options = {}) {
  if (options.archive) options = { ...options, archive: { metadataDirectory: join(home, 'archive-metadata'), ...options.archive } };
  const tracker = createCodexImageTracker(home, options);
  const stream = JSON.stringify({ type: 'thread.started', thread_id: threadId }) + '\n';
  for (let i = 0; i < stream.length; i += 7) tracker.write(stream.slice(i, i + 7));
  return tracker;
}

test('chunked CLI events attach only the current session image, including nested output', async t => {
  const home = await fixture(t);
  const path = join(home, 'generated_images', id, 'nested', 'fox.png');
  await writeFile(path, png);
  await writeFile(join(home, 'generated_images', otherId, 'private.png'), png);
  const files = await track(home).collect();
  assert.deepEqual(files, [path]);
  assert.deepEqual(await resolveImages(generatedImageReply(files)), [path]);
  const segment = await imageSegment(path, [join(home, 'generated_images')]);
  assert.equal(segment.type, 'image');
  assert.equal(segment.data.file, 'base64://' + png.toString('base64'));
});

test('no thread ID, traversal, and session symlinks cannot expose another session', async t => {
  const home = await fixture(t);
  await writeFile(join(home, 'generated_images', otherId, 'private.png'), png);
  assert.deepEqual(await createCodexImageTracker(home).collect(), []);
  assert.deepEqual(await track(home, '../' + otherId).collect(), []);
  const linkId = '33333333-3333-4333-8333-333333333333';
  await symlink(join(home, 'generated_images', otherId), join(home, 'generated_images', linkId));
  assert.deepEqual(await track(home, linkId).collect(), []);
});

test('a file with a fake image extension fails before delivery', async t => {
  const home = await fixture(t);
  await writeFile(join(home, 'generated_images', id, 'fake.png'), 'not an image');
  await assert.rejects(track(home).collect(), /Unsupported QQ image content/);
});

test('large generated images are compressed below the QQ size cap', { skip: process.platform !== 'darwin' }, async t => {
  const home = await fixture(t);
  await writeFile(join(home, 'generated_images', id, 'large.png'), Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]));
  const [path] = await track(home).collect();
  assert.ok(path.endsWith('/qq-delivery/large.png.jpg'));
  assert.ok((await stat(path)).size < 5 * 1024 * 1024);
  assert.equal((await imageSegment(path, [join(home, 'generated_images')])).type, 'image');
});

test('archive keeps every original before the delivery cap/compression and retries do not duplicate records', { skip: process.platform !== 'darwin' }, async t => {
  const home = await fixture(t);
  for (const name of ['a.png', 'b.png', 'c.png']) await writeFile(join(home, 'generated_images', id, name), png);
  const large = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
  await writeFile(join(home, 'generated_images', id, 'z.png'), large);
  const directory = join(home, 'Downloads', 'AI群友生图');
  const context = { type: 'private_message', senderId: '123', request: '画一张表情包', model: 'test-model' };
  const tracker = track(home, id, { archive: { directory, context } });
  assert.equal((await tracker.collect()).length, 3);
  assert.equal(tracker.archiveResult.ok, true);
  assert.equal(tracker.archiveResult.directory, directory);
  assert.equal(tracker.archiveResult.recordPath, join(home, 'archive-metadata', '生成记录', `${id}.json`));
  const record = JSON.parse(await readFile(tracker.archiveResult.recordPath, 'utf8'));
  assert.deepEqual(record.context, context);
  assert.equal(record.images.length, 4);
  assert.equal(record.layout, 'flat');
  const original = record.images.find(i => i.name.endsWith('z.png'));
  assert.ok((await readFile(join(tracker.archiveResult.directory, original.name))).equals(large));
  await tracker.collect();
  assert.equal(tracker.archiveResult.alreadyArchived, true);
  assert.equal((await readFile(join(home, 'archive-metadata', '生成索引.jsonl'), 'utf8')).trim().split('\n').length, 1);
  const visibleFiles = await readdir(directory, { withFileTypes: true });
  assert.equal(visibleFiles.length, 4);
  assert.ok(visibleFiles.every(f => f.isFile() && f.name.endsWith('.png')));
});

test('flat images with the same original filename from different sessions do not collide', async t => {
  const home = await fixture(t);
  const directory = join(home, 'archive');
  for (const threadId of [id, otherId]) {
    await writeFile(join(home, 'generated_images', threadId, 'fox.png'), png);
    const tracker = track(home, threadId, { archive: { directory } });
    await tracker.collect();
    assert.equal(tracker.archiveResult.ok, true);
  }
  assert.equal((await readdir(directory)).filter(n => n.endsWith('.png')).length, 2);
});

test('migration flattens old images, keeps metadata and is repeatable without duplication', async t => {
  const home = await fixture(t);
  const directory = join(home, 'archive');
  const folder = join(directory, '2026-09-24', id);
  await mkdir(folder, { recursive: true });
  const originalPath = join(home, 'generated_images', id, 'fox.png');
  await writeFile(originalPath, png);
  const record = { version: 1, threadId: id, context: { request: '画狐宫静' }, images: [{ name: '01-fox.png', originalPath, sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length }] };
  await writeFile(join(folder, '01-fox.png'), png);
  await writeFile(join(folder, '生成记录.json'), JSON.stringify(record));
  await writeFile(join(folder, '生成说明.txt'), '文件：01-fox.png');
  await writeFile(join(directory, '生成索引.jsonl'), JSON.stringify(record) + '\n');
  await writeFile(join(directory, '使用说明.txt'), '旧说明');
  const result = await flattenArchive(directory);
  assert.equal(result.images, 1);
  assert.deepEqual(await readFile(join(directory, `${id}-01-fox.png`)), png);
  assert.equal((await readdir(directory)).includes('2026-09-24'), false);
  const flat = JSON.parse(await readFile(join(directory, '生成记录', `${id}.json`), 'utf8'));
  assert.deepEqual(flat.context, record.context);
  assert.equal(flat.images[0].name, `${id}-01-fox.png`);
  assert.deepEqual(JSON.parse(await readFile(join(result.backupDir, `${id}.json`), 'utf8')), record);
  assert.equal((await flattenArchive(directory)).images, 0);
  const tracker = track(home, id, { archive: { directory, metadataDirectory: directory } });
  await tracker.collect();
  assert.equal(tracker.archiveResult.alreadyArchived, true);
  assert.equal((await readFile(join(directory, '生成索引.jsonl'), 'utf8')).trim().split('\n').length, 1);
});

test('migration refuses corrupt originals before changing source layout', async t => {
  const home = await fixture(t);
  const directory = join(home, 'archive');
  const folder = join(directory, '2026-09-24', id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, '01-fox.png'), png);
  await writeFile(join(folder, '生成记录.json'), JSON.stringify({ threadId: id, images: [{ name: '01-fox.png', sha256: 'incorrect' }] }));
  await assert.rejects(flattenArchive(directory), /checksum mismatch/);
  assert.deepEqual(await readFile(join(folder, '01-fox.png')), png);
  assert.deepEqual(await readdir(directory), ['2026-09-24']);
});

test('archive failure is reported without discarding an otherwise deliverable image', async t => {
  const home = await fixture(t);
  await writeFile(join(home, 'generated_images', id, 'fox.png'), png);
  const directory = join(home, 'not-a-directory');
  await writeFile(directory, 'existing file');
  const tracker = track(home, id, { archive: { directory } });
  assert.equal((await tracker.collect()).length, 1);
  assert.equal(tracker.archiveResult.ok, false);
  assert.ok(tracker.archiveResult.error);
});
