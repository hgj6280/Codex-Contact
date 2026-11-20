import {adminFetch} from './qq-admin-fetch.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const hub = 'http://127.0.0.1:3789';
const bridge = 'http://127.0.0.1:3000';
const domain = `gui/${process.getuid()}`;

async function request(url, options = {}) {
  const response = await adminFetch(url, { ...options, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`服务返回 ${response.status}`);
  return response.json();
}

async function startService(label) {
  // The LaunchAgents point at a verified release in Application Support.
  let registered;
  try {
    registered = (await exec('/bin/launchctl', ['print', `${domain}/${label}`], { timeout: 8000 })).stdout;
  } catch {
    await exec('/bin/launchctl', ['bootstrap', domain, join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)], { timeout: 8000 });
  }
  // Do not restart a running service: it may be handling another conversation.
  if (!registered || !/state = running/.test(registered)) {
    await exec('/bin/launchctl', ['kickstart', `${domain}/${label}`], { timeout: 8000 });
  }
}

async function waitForHub() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const state = await request(`${hub}/api/state`).catch(() => null);
    if (state) return state;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('控制面板尚未启动成功，请稍后再点一次，或检查本机服务。');
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  let state = await request(`${hub}/api/state`).catch(() => null);
  if (statusOnly) {
    console.log(state ? `QQ 群友当前${state.channels.qq ? '开启' : '关闭'}` : 'QQ 群友服务未启动');
    return;
  }
  if (!state) {
    await startService('local.codexremotecontact.chat-hub');
    state = await waitForHub();
  }
  const enable = !state.channels.qq;
  let bridgeStartError = false;
  if (enable && !(await request(`${bridge}/health`).catch(() => null))) {
    try { await startService('local.codexremotecontact.qq-napcat'); }
    catch { bridgeStartError = true; }
  }
  const applied = await request(`${hub}/api/channel`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'qq', enabled: enable })
  });
  const verified = await request(`${hub}/api/state`);
  if (applied.channels.qq !== enable || verified.channels.qq !== enable) throw new Error('开关状态未保存成功，请稍后重试。');
  if (!enable) {
    console.log('QQ 群友已关闭\n已暂停 QQ 回复，保留 QQ 登录；iMessage 不受影响。');
    return;
  }
  const health = await request(`${bridge}/health`).catch(() => null);
  const login = health?.connected ? await request(`${bridge}/get_status`).catch(() => null) : null;
  const online = login?.status === 'ok' && login.data?.online === true;
  console.log(online
    ? 'QQ 群友已开启\nQQ 连接正常，可以在白名单群里 @ 狐宫静。'
    : `QQ 回复开关已开启\n${bridgeStartError ? 'QQ 连接服务启动失败' : 'QQ 连接正在启动，或需要扫码登录'}；请打开控制面板检查。`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
