import { readdir, realpath, stat, mkdir } from 'node:fs/promises';
import { join, sep, basename, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { imageSegment } from './qq-media.mjs';
import { archiveQqImages } from './qq-image-archive.mjs';
import {parseQqImageRequest} from './qq-image-request.mjs';

const execFileAsync = promisify(execFile);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isImageGenerationRequest(text) {
  return parseQqImageRequest(text).requested;
}

// The exec JSON stream identifies the exact session owning the generated files.
// Never scan the whole image library or trust a path claimed in model prose.
export function createCodexImageTracker(codexHomeDir, { archive } = {}) {
  const threads = new Set();
  let pending = '';
  let archiveResult = null;
  return {
    get archiveResult() { return archiveResult; },
    write(chunk) {
      // thread.started is the first small JSONL event. Ignore the rest once found.
      if (threads.size) return;
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'thread.started' && uuid.test(event.thread_id || '')) {
            threads.add(event.thread_id);
            pending = '';
            return;
          }
        } catch { /* Ignore non-JSON diagnostic lines. */ }
      }
      if (pending.length > 64 * 1024) pending = '';
    },
    async collect() {
      const root = await realpath(join(codexHomeDir, 'generated_images')).catch(() => null);
      if (!root) return [];
      const files = [];
      for (const id of threads) {
        const expected = join(root, id);
        const sessionDir = await realpath(expected).catch(() => null);
        if (sessionDir !== expected) continue;
        async function walk(dir, depth = 0) {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (entry.name === 'qq-delivery') continue;
            const path = join(dir, entry.name);
            if (entry.isDirectory() && depth < 3) await walk(path, depth + 1);
            if (entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name)) {
              const canonical = await realpath(path);
              if (canonical.startsWith(sessionDir + sep)) files.push(canonical);
            }
          }
        }
        await walk(sessionDir);
      }
      if (archive && files.length) {
        try {
          archiveResult = await archiveQqImages({ ...archive, sourceRoot: root, threadId: [...threads][0], files: files.sort() });
        } catch (error) {
          archiveResult = { ok: false, error: error.message };
          console.warn(`QQ image archive failed: ${error.message}`);
        }
      }
      const ready = [];
      for (const file of files.sort().slice(-3)) {
        const info = await stat(file);
        if (info.size > 40 * 1024 * 1024) throw new Error('Generated image is too large to deliver');
        let delivered = file;
        if (info.size > 5 * 1024 * 1024) {
          const dir = join(dirname(file), 'qq-delivery');
          await mkdir(dir, { recursive: true, mode: 0o700 });
          delivered = join(dir, basename(file) + '.jpg');
          await execFileAsync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '2048', file, '--out', delivered], { timeout: 30000 });
        }
        await imageSegment(delivered, [root]);
        ready.push(delivered);
      }
      return ready;
    }
  };
}

export function generatedImageReply(paths) {
  return ['画好啦，给你看看～', ...paths.map(path => `[[qq_image:${path}]]`)].join('\n');
}
