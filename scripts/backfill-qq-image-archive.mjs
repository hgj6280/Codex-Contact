import {adminFetch} from './qq-admin-fetch.mjs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexImageTracker } from '../src/qq-codex-images.mjs';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const codexHome = join(homedir(), '.codex');
const sourceRoot = join(codexHome, 'generated_images');
const directory = process.env.CODEX_REMOTE_CONTACT_QQ_IMAGE_ARCHIVE_DIR || join(homedir(), 'Downloads', 'AI群友生图');
const memory = JSON.parse(await readFile(join(projectDir, 'data', 'qq-memory.json'), 'utf8'));
const sessions = new Map();
function addRecord(reply, context) {
  for (const match of String(reply || '').matchAll(/\[\[qq_image:([^\]\r\n]+)\]\]/g)) {
    const rel = relative(sourceRoot, match[1]);
    const id = rel.split(sep)[0];
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) && !sessions.has(id)) sessions.set(id, context);
  }
}
for (const [groupId, entries] of Object.entries(memory.entries || {})) {
  for (const entry of entries) addRecord(entry.reply, {
    type: 'group_message', groupId, senderId: entry.senderId, senderLabel: entry.senderLabel,
    request: entry.userText, quotedText: entry.quotedText, recordedReplyAt: entry.at, backfilled: true
  });
}
// The live dashboard may still hold private replies not included in group memory.
const live = await adminFetch('http://127.0.0.1:3789/api/state', { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null);
for (const record of live?.qq?.events || []) {
  const e = record.event || {};
  addRecord(record.reply, { type: e.type, groupId: e.groupId, senderId: e.senderId, senderLabel: e.senderLabel,
    request: e.text, quotedText: e.replyContext?.text, recordedReplyAt: record.receivedAt, backfilled: true });
}
let archived = 0;
let images = 0;
const skipped = [];
for (const [id, context] of sessions) {
  const tracker = createCodexImageTracker(codexHome, { archive: { directory, context } });
  tracker.write(JSON.stringify({ type: 'thread.started', thread_id: id }) + '\n');
  try {
    await tracker.collect();
    if (tracker.archiveResult?.ok) {
      archived++;
      images += tracker.archiveResult.count;
    } else skipped.push({ id, reason: tracker.archiveResult?.error || 'Source images no longer available' });
  } catch (error) { skipped.push({ id, reason: error.message }); }
}
console.log(JSON.stringify({ directory, matchedSessions: sessions.size, archivedSessions: archived, images, skipped }));
