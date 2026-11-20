import { readdir, readFile, realpath, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { archiveQqImages, indexArchivedImages } from '../src/qq-image-archive.mjs';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function backfillNanoBananaArchive({
  directory = process.env.CODEX_REMOTE_CONTACT_QQ_IMAGE_ARCHIVE_DIR || join(homedir(), 'Downloads', 'AI群友生图'),
  metadataDirectory = join(projectDir, 'data', 'qq-image-archive'),
  sourceRoots = [join(homedir(), '.codex', 'generated_images', 'nano-banana-2'), join(metadataDirectory, 'nano-banana-2')]
} = {}) {
  const index = await indexArchivedImages(directory);
  // Preserve an audit outside Downloads; no reference/input/cache image scan.
  const before = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    if (entry.isFile()) before.push({name: entry.name, sha256: createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex')});
  }
  const result = { directory, copied: 0, reused: 0, sessions: [], skipped: [], preservedFiles: before.length };
  for (const sourceRoot of sourceRoots) {
    const root = await realpath(sourceRoot).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!root) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !uuid.test(entry.name)) continue;
      const id = entry.name, session = join(root, id);
      const reportPath = join(metadataDirectory, `validation_report-${id}.json`);
      const report = await readFile(reportPath, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (!report || !(report.requestedImageProvider === 'nano-banana-2' || report.model === 'ag/gemini-3.1-flash-image')) {
        result.skipped.push({ id, reason: 'No matching QQ Gemini generation report' }); continue;
      }
      // Only actual provider output files in its dedicated session directory.
      const files = (await readdir(session, { withFileTypes: true }))
        .filter(e => e.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(e.name)).map(e => join(session, e.name)).sort();
      if (!files.length) continue;
      try {
        const archive = await archiveQqImages({ directory, metadataDirectory, sourceRoot: root, threadId: id, files,
          existingImagesByChecksum: index,
          context: { model: 'ag/gemini-3.1-flash-image', provider: 'nano-banana-2', request: report.originalRequest,
            referencePaths: report.referencePaths || [], identityReferencePaths: report.identityPaths || [],
            validationReportPath: reportPath, backfilled: true } });
        result.copied += archive.copied; result.reused += archive.reused;
        result.sessions.push({ id, ...archive });
      } catch (error) { result.skipped.push({ id, reason: error.message }); }
    }
  }
  for (const file of before) {
    const after = createHash('sha256').update(await readFile(join(directory, file.name))).digest('hex');
    if (after !== file.sha256) throw new Error(`Existing file changed: ${file.name}`);
  }
  await mkdir(metadataDirectory, {recursive: true, mode: 0o700});
  result.auditPath = join(metadataDirectory, `nano-backfill-${randomUUID()}.json`);
  await writeFile(result.auditPath, JSON.stringify({ ...result, verifiedAt: new Date().toISOString(), before }, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await backfillNanoBananaArchive();
  console.log(JSON.stringify(result));
  if (result.skipped.length) process.exitCode = 1;
}
