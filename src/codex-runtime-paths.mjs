import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Mutable CLI files must not live beside source code in iCloud Documents.
export function codexRuntimePaths({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const base = platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'CodexRemoteContact')
    : platform === 'win32'
      ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'CodexRemoteContact')
      : join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'CodexRemoteContact');
  const root = resolve(env.CODEX_REMOTE_CONTACT_LOCAL_RUNTIME_DIR || base);
  return {
    character: resolve(env.CODEX_REMOTE_CONTACT_QQ_CHARACTER_DIR || join(root, 'assets', 'qq-character', 'hugongjing')),
    incomingImages: resolve(env.CODEX_REMOTE_CONTACT_QQ_INCOMING_IMAGES_DIR || join(root, 'runtime', 'qq-images')),
    workspace: resolve(env.CODEX_REMOTE_CONTACT_CODEX_WORKSPACE_DIR || join(root, 'workspaces', 'codex-cli')),
    replies: resolve(env.CODEX_REMOTE_CONTACT_CODEX_REPLIES_DIR || join(root, 'runtime', 'replies')),
    webPublic: resolve(env.CODEX_REMOTE_CONTACT_WEB_PUBLIC_DIR || join(root, 'web-public'))
  };
}
