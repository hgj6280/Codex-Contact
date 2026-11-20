import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// A durable local copy survives iCloud evicting the repository's source assets.
export async function ensureCharacterCache(source, destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const hashes = {};
  for (const name of ['appearance.md', 'reference-default.png', 'reference-summer.png']) {
    const path = join(destination, name);
    let bytes;
    try { bytes = await readFile(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      bytes = await readFile(join(source, name));
      if (!bytes.length || (name.endsWith('.png') && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) throw new Error(`Invalid OC asset: ${name}`);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, path);
    }
    if (!bytes.length || (name.endsWith('.png') && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) throw new Error(`Invalid cached OC asset: ${name}`);
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({version:1, hashes}, null, 2), {mode:0o600});
  return destination;
}
