// Operator-invoked setup only: the chat server never installs dependencies itself.
import {mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {codexRuntimePaths} from '../src/codex-runtime-paths.mjs';
const directory=join(dirname(codexRuntimePaths().webPublic),'image-search-runtime');
await mkdir(directory,{recursive:true,mode:0o700});
await promisify(execFile)(join(dirname(process.execPath),'npm'),['install','--prefix',directory,'--ignore-scripts','--no-audit','--no-fund','--save-exact','cheerio@1.2.0','undici@8.12.3'],{timeout:120000,maxBuffer:65536});
console.log(JSON.stringify({directory,ready:true}));
