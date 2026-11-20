import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {ensureQqBackend} from './backend.mjs';
const exec = promisify(execFile);
console.log(`QQ backend: ${await ensureQqBackend({exec})}`);
await import('./bridge.mjs');
