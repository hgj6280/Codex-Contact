import test from 'node:test';
import {GEMINI_ROUTER_MODEL} from './qq-text-context.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {matchQqTrigger} from './qq-triggers.mjs';
import {isQqConversationAiEnabled} from './qq-conversation-ai.mjs';
import { createUsageTracker, normalizeUsage, openUsageLedger, isUsageQuestion, formatUsageReply } from './qq-usage.mjs';

const usage = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 12, reasoning_output_tokens: 4 };
const event = JSON.stringify({ type: 'turn.completed', usage });
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'qq-usage-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('JSONL chunks, malformed lines, oversized payloads, deduplication and trailing data', () => {
  const result = [];
  const tracker = createUsageTracker(u => result.push(u));
  const stream = 'not json\n' + 'x'.repeat(1024 * 1024 + 3) + '\n{"type":"turn.started"}\n' + event + '\n' + event + '\n';
  for (let i = 0; i < stream.length; i += 17) tracker.write(stream.slice(i, i + 17));
  assert.deepEqual(result, [{ inputTokens: 100, cachedInputTokens: 80, outputTokens: 12, totalTokens: 112 }]);
  tracker.write('{"type":"turn.started"}\n' + event);
  tracker.end();
  assert.equal(result.length, 2);
  assert.equal(normalizeUsage({ ...usage, input_tokens: -1 }), null);
  assert.equal(normalizeUsage({ ...usage, cached_input_tokens: 200 }), null);
  assert.equal(normalizeUsage({ input_tokens: 3 }), null);
});

test('concurrent calls persist across restart; cached tokens are not counted twice', async t => {
  const path = await fixture(t);
  const ledger = await openUsageLedger(path);
  await Promise.all(Array.from({ length: 15 }, async () => {
    const call = ledger.start('test');
    call.write(event + '\n');
    await Promise.all([call.finish('completed'), call.finish('completed')]);
  }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.total.totalTokens, 1680);
  assert.equal(snapshot.total.inputTokens, 1500);
  assert.equal(snapshot.total.cachedInputTokens, 1200);
  assert.equal(snapshot.total.calls, 15);
  assert.equal(snapshot.total.incompleteCalls, 0);
  assert.deepEqual((await openUsageLedger(path)).snapshot(), snapshot);
  const files = await readdir(join(path, 'calls'));
  assert.equal(files.length, 15);
  assert.equal(files.every(n => n.endsWith('.json')), true);
});

test('Beijing midnight resets only today, not cumulative counters or recording start', async t => {
  const path = await fixture(t);
  let date = new Date('2026-09-24T15:59:59Z');
  const ledger = await openUsageLedger(path, { now: () => date });
  const first = ledger.start('first'); first.write(event); await first.finish('completed');
  assert.equal(ledger.snapshot().todayDate, '2026-09-24');
  date = new Date('2026-09-24T16:00:01Z');
  assert.equal(ledger.snapshot().today.totalTokens, 0);
  const second = ledger.start('second'); second.write(event); await second.finish('completed');
  assert.equal(ledger.snapshot().today.totalTokens, 112);
  assert.equal(ledger.snapshot().total.totalTokens, 224);
  assert.equal(ledger.snapshot().startedAt, '2026-09-24T15:59:59.000Z');
});

test('missing usage and failures are explicit, not claimed as zero-cost successes', async t => {
  const ledger = await openUsageLedger(await fixture(t));
  const failed = ledger.start('test'); await failed.finish('failed');
  const timeout = ledger.start('test'); timeout.write(event); await timeout.finish('timeout');
  const missing = ledger.start('test'); await missing.finish('completed');
  ledger.start('pending');
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.total.totalTokens, 112);
  assert.equal(snapshot.total.incompleteCalls, 3);
  assert.equal(snapshot.total.pendingCalls, 1);
  assert.match(formatUsageReply(snapshot), /部分用量未返回/);
  // Flush this test's pending write before fixture cleanup.
  await new Promise(r => setTimeout(r, 30));
});

test('natural-language QQ queries bypass model and admin-only command routing', async () => {
  for (const text of ['狐宫静，今日用量', '/累计用量', '狐宫静你今天消耗了多少 token 啦？', '查看token统计', '用量统计', '[CQ:at,qq=123] 总用量']) assert.equal(isUsageQuestion(text), true, text);
  for (const text of ['狐宫静你好', 'token 是什么', '读取 access token 密钥', '查询配置文件的 token']) assert.equal(isUsageQuestion(text), false, text);
  const source = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  const start = source.indexOf('function buildQqCommandAction(event)');
  const end = source.indexOf('function extractQqCommandTarget', start);
  const reply = vm.runInNewContext(source.slice(start, end) + '\nbuildQqCommandAction({text:"狐宫静，今日用量",isOwner:false})', {
    GEMINI_ROUTER_MODEL,state:{ai:{qqReplyProvider:'codex-cli'}},stripMentionText: text => text, isUsageQuestion, formatUsageReply: () => '精确账本', qqUsageLedger: { snapshot: () => ({}) }
  });
  assert.equal(reply.reply, '精确账本');
});

test('usage query still respects channel, ban and group allowlist gates', async () => {
  const source = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  const start = source.indexOf('function shouldRespondToQq(event)');
  const end = source.indexOf('function hasUnhandledQqAudio', start);
  const check = (enabled, banned, groupId) => vm.runInNewContext(source.slice(start, end) + '\nshouldRespondToQq(event)', {
    event: { text: '狐宫静，今日用量', groupId, senderId: 'test' },
    roleplay: {}, state: { channels: { qq: enabled }, qq: { allowedGroups: ['allowed'] } },
    matchQqTrigger,isQqConversationAiEnabled,aiGroups:()=>['allowed'],aiUsers:()=>[],parseModerationCommand:()=>null,stripMentionText:t=>t,
    isBannedQqSender: () => banned, hasUnhandledQqAudio: () => false, isQqModelQuestion:()=>false
  }).ok;
  assert.equal(check(true, false, 'allowed'), true);
  assert.equal(check(true, false, 'unlisted'), false);
  assert.equal(check(false, false, 'allowed'), false);
  assert.equal(check(true, true, 'allowed'), false);
});
