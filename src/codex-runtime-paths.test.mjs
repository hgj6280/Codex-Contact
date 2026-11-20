import test from 'node:test';
import assert from 'node:assert/strict';
import { codexRuntimePaths } from './codex-runtime-paths.mjs';

test('macOS CLI workspace and reply output stay outside iCloud Documents', () => {
  const paths = codexRuntimePaths({ env: {}, platform: 'darwin', home: '/Users/test' });
  assert.equal(paths.workspace, '/Users/test/Library/Application Support/CodexRemoteContact/workspaces/codex-cli');
  assert.equal(paths.replies, '/Users/test/Library/Application Support/CodexRemoteContact/runtime/replies');
  assert.equal(paths.webPublic, '/Users/test/Library/Application Support/CodexRemoteContact/web-public');
  assert.equal(paths.character, '/Users/test/Library/Application Support/CodexRemoteContact/assets/qq-character/hugongjing');
  assert.equal(paths.incomingImages, '/Users/test/Library/Application Support/CodexRemoteContact/runtime/qq-images');
  assert.ok(!paths.workspace.includes('/Documents/'));
});

test('explicit local runtime and individual directory overrides are honored', () => {
  assert.deepEqual(codexRuntimePaths({ env: { CODEX_REMOTE_CONTACT_LOCAL_RUNTIME_DIR: '/local/bot' } }), {
    character:'/local/bot/assets/qq-character/hugongjing', incomingImages:'/local/bot/runtime/qq-images',
    workspace: '/local/bot/workspaces/codex-cli', replies: '/local/bot/runtime/replies', webPublic: '/local/bot/web-public'
  });
  assert.deepEqual(codexRuntimePaths({ env: {
    CODEX_REMOTE_CONTACT_CODEX_WORKSPACE_DIR: '/local/work', CODEX_REMOTE_CONTACT_CODEX_REPLIES_DIR: '/local/out'
  }, platform: 'darwin', home: '/Users/test' }), {
    character:'/Users/test/Library/Application Support/CodexRemoteContact/assets/qq-character/hugongjing',
    incomingImages:'/Users/test/Library/Application Support/CodexRemoteContact/runtime/qq-images',
    workspace: '/local/work', replies: '/local/out',
    webPublic: '/Users/test/Library/Application Support/CodexRemoteContact/web-public'
  });
});

test('Linux respects XDG local state storage', () => {
  assert.equal(codexRuntimePaths({ env: { XDG_STATE_HOME: '/local/state' }, platform: 'linux', home: '/home/test' }).workspace,
    '/local/state/CodexRemoteContact/workspaces/codex-cli');
});
