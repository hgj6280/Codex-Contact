import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const base = fileURLToPath(new URL('./', import.meta.url));
await mkdir(join(base, 'state/config'), { recursive: true, mode: 0o700 });
await mkdir(join(base, 'state/qq'), { recursive: true, mode: 0o700 });
async function createOnly(path, value) {
  try { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}
await createOnly(join(base, 'state/bridge.json'), {
  token: randomBytes(32).toString('hex'), allowedUsers: [], allowedGroups: []
});
const { token } = JSON.parse(await readFile(join(base, 'state/bridge.json')));
await createOnly(join(base, 'state/config/webui.json'), {
  host: '0.0.0.0', port: 6099, prefix: '', token: randomBytes(32).toString('hex'), loginRate: 3
});
await createOnly(join(base, 'state/config/onebot11.json'), {
  network: {
    httpServers: [], httpSseServers: [], httpClients: [], websocketClients: [], plugins: [],
    websocketServers: [{ enable: true, name: 'hub-bridge', host: '0.0.0.0', port: 3001,
      messagePostFormat: 'array', reportSelfMessage: false, enableForcePushEvent: true,
      token, debug: false, heartInterval: 30000 }]
  }, musicSignUrl: '', enableLocalFile2Url: false, parseMultMsg: false
});
console.log('NapCat local configuration ready. Credentials remain in state/.');
