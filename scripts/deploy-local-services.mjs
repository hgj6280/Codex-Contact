import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, mkdtemp, readFile, readdir, symlink, rename, realpath, lstat, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash, randomUUID} from 'node:crypto';

// Run after source edits, before restarting launchd. Publish a complete local
// release atomically; never execute Node modules directly from iCloud Documents.
const exec = promisify(execFile);
const source = fileURLToPath(new URL('..', import.meta.url));
const root = join(homedir(), 'Library', 'Application Support', 'CodexRemoteContact');
const releases = join(root, 'service-releases');
await mkdir(releases, {recursive:true, mode:0o700});
const stage = await mkdtemp(join(releases, 'release-'));
await mkdir(join(stage, 'modules'), {recursive:true});
await mkdir(join(stage, 'scripts'), {recursive:true});
const copy = async (from, to) => exec('/bin/cp', ['-R', from, to], {timeout:120000});
await copy(join(source, 'src'), join(stage, 'src'));
await copy(join(source, 'package.json'), join(stage, 'package.json'));
await copy(join(source, 'modules', 'qq-napcat'), join(stage, 'modules', 'qq-napcat'));
await mkdir(join(stage, 'modules', 'web-console'), {recursive:true});
await copy(join(source, 'modules', 'web-console', 'public'), join(stage, 'modules', 'web-console', 'public'));
await copy(join(source, 'scripts', 'qq-admin-fetch.mjs'), join(stage, 'scripts', 'qq-admin-fetch.mjs'));
await copy(join(source, 'scripts', 'qq-desktop-start.mjs'), join(stage, 'scripts', 'qq-desktop-start.mjs'));
await copy(join(source, 'scripts', 'qq-friend-toggle.mjs'), join(stage, 'scripts', 'qq-friend-toggle.mjs'));
for (const name of ['rollback-qq-chat-storage.mjs','回滚聊天记录存储.command']) {
  await copy(join(source,'scripts',name),join(stage,'scripts',name));
}
// Mutable state and OC cache remain in their existing local locations; no copy,
// migration, credential rotation, message reset, or Docker volume changes.
await symlink(join(root, 'data'), join(stage, 'data'));
await symlink(join(root, 'runtime'), join(stage, 'runtime'));
await symlink(join(root, 'assets'), join(stage, 'assets'));
for (const name of ['shadowrocket', 'system-control']) {
  try { await lstat(join(source, 'modules', name)); await symlink(join(source, 'modules', name), join(stage, 'modules', name)); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
// Validate every published source/asset from the non-cloud copy, not from an
// evictable source path. A failed copy/check never replaces the active release.
const hashes = {};
async function inventory(path, relative = '') {
  for (const entry of await readdir(path, {withFileTypes:true})) {
    const next = join(path, entry.name), key = join(relative, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await inventory(next, key);
    else hashes[key] = createHash('sha256').update(await readFile(next)).digest('hex');
  }
}
await inventory(stage);
await exec(process.execPath, ['--check', join(stage, 'src', 'server.js')]);
await exec(process.execPath, ['--check', join(stage, 'modules', 'qq-napcat', 'bridge.mjs')]);
const statePath = join(stage, 'modules', 'qq-napcat', 'state');
if (await realpath(statePath) !== join(root, 'napcat-state')) throw new Error('QQ state path changed; release not published');
await writeFile(join(stage, 'release-manifest.json'), JSON.stringify({createdAt:new Date().toISOString(), source, hashes}, null, 2), {mode:0o600});
const current = join(root, 'service-code');
try { if (!(await lstat(current)).isSymbolicLink()) throw new Error('service-code already exists and is not a managed link'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const link = join(root, `service-code.${randomUUID()}.tmp`);
await symlink(stage, link);
await rename(link, current);
console.log(JSON.stringify({release:stage, active:current, files:Object.keys(hashes).length, sourcePreserved:true}));
