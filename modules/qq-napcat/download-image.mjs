// Fetch the public Docker Hub image through the Mac network, then build a docker-load archive.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const repo = 'mlikiowa/napcat-docker';
const work = await mkdtemp(join(tmpdir(), 'napcat-image-'));
async function json(url, headers = []) {
  const { stdout } = await exec('/usr/bin/curl', ['-fsSL', '--retry', '4', '--max-time', '60', ...headers, url], { maxBuffer: 8e6 });
  return JSON.parse(stdout);
}
const { token } = await json(`https://auth.docker.io/token?scope=repository:${repo}:pull&service=registry.docker.io`);
const headers = ['-H', `Authorization: Bearer ${token}`];
const accept = ['-H', 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'];
const base = `https://registry-1.docker.io/v2/${repo}`;
const index = await json(`${base}/manifests/latest`, [...headers, ...accept]);
const descriptor = index.manifests?.find(m => m.platform.os === 'linux' && m.platform.architecture === 'arm64');
if (!descriptor) throw new Error('No Linux ARM64 image');
const manifest = await json(`${base}/manifests/${descriptor.digest}`, [...headers, ...accept]);
console.log(`Official ARM64 manifest: ${descriptor.digest}; ${manifest.layers.length} layers; ${Math.round(manifest.layers.reduce((n,l)=>n+l.size,0)/1048576)} MiB compressed`);
const configName = manifest.config.digest.split(':')[1] + '.json';
async function blob(descriptor, target) {
  await exec('/usr/bin/curl', ['-fsSL', '--retry', '6', '--retry-all-errors', '--connect-timeout', '20', '--max-time', '1800', ...headers,
    '-o', target, `${base}/blobs/${descriptor.digest}`], { maxBuffer: 1e6 });
  const { stdout } = await exec('/usr/bin/shasum', ['-a', '256', target]);
  if (!stdout.startsWith(descriptor.digest.split(':')[1])) throw new Error('Image blob checksum mismatch');
}
await blob(manifest.config, join(work, configName));
const layers = [];
for (let i=0; i<manifest.layers.length; i++) {
  const layer = manifest.layers[i];
  const dir = layer.digest.split(':')[1];
  await mkdir(join(work, dir));
  const compressed = join(work, dir, 'layer.tar.gz');
  await blob(layer, compressed);
  await exec('/usr/bin/gunzip', [compressed]);
  layers.push(`${dir}/layer.tar`);
  console.log(`Layer ${i+1}/${manifest.layers.length} verified`);
}
await writeFile(join(work, 'manifest.json'), JSON.stringify([{ Config: configName, RepoTags: [`${repo}:latest`], Layers: layers }]));
await writeFile(join(work, 'source-digest.txt'), descriptor.digest);
const archive = join(work, 'image.tar');
await exec('/usr/bin/tar', ['-cf', archive, '-C', work, 'manifest.json', configName, ...layers]);
console.log(`Archive ready: ${archive}`);
await new Promise((resolve,reject)=> {
  const child=spawn('/opt/homebrew/bin/docker',['load','-i',archive],{stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`docker load: ${code}`)));
});
