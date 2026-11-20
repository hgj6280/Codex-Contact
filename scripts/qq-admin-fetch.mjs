import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

const origins = new Set(['http://127.0.0.1:3789', 'http://127.0.0.1:3000']);
const keyFile = join(homedir(), 'Library', 'Application Support', 'CodexRemoteContact', 'napcat-state', 'desktop.key');
export function createAdminFetch(getKey, transport = fetch) {
  return async (input, options = {}) => {
    const url = new URL(input);
    if (!origins.has(url.origin) || url.username || url.password) throw Error('无效的本机服务地址');
    const headers = new Headers(options.headers);
    headers.set('x-qq-desktop-key', await getKey());
    return transport(url.href, {...options, headers, redirect:'error'});
  };
}
export const adminFetch = createAdminFetch(async () => (await readFile(keyFile, 'utf8')).trim());
