import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { estimateTokenCost, formatEstimatedCost, usdToCny, pricingInfo } from './qq-token-pricing.mjs';
import { openUsageLedger, formatUsageReply, isUsageQuestion } from './qq-usage.mjs';

test('cache uses discounted rate and is subtracted from full-rate input', () => {
  const usd = estimateTokenCost('gpt-6-luna', { inputTokens: 1000000, cachedInputTokens: 800000, outputTokens: 100000 });
  assert.ok(Math.abs(usd - 0.078) < 1e-12);
  assert.equal(estimateTokenCost('unknown-model', { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }), null);
  assert.equal(estimateTokenCost('gpt-6-luna', { inputTokens: 1, cachedInputTokens: 2, outputTokens: 1 }), null);
});

test('mixed model estimates, short replies, scope selection and persistence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qq-price-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = await openUsageLedger(dir);
  for (const model of ['gpt-6-luna', 'gpt-6-sol']) {
    const call = ledger.start(model);
    call.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100000, cached_input_tokens: 80000, output_tokens: 10000 } }));
    await call.finish('completed');
  }
  const snapshot = ledger.snapshot();
  assert.ok(Math.abs(snapshot.total.estimatedUsd - (0.0078 + 0.156)) < 1e-12);
  assert.ok(Math.abs(snapshot.total.estimatedCny - 1.10546982) < 1e-12);
  assert.equal(snapshot.today.estimatedCny, snapshot.total.estimatedCny);
  assert.equal(snapshot.pricing.currency, 'CNY');
  assert.deepEqual((await openUsageLedger(dir)).snapshot(), snapshot);
  const short = formatUsageReply(snapshot);
  assert.equal(short.split('\n').length, 2);
  assert.ok(short.length < 160);
  assert.match(short, /¥1.1055/);
  assert.doesNotMatch(short, /\$/);
  assert.doesNotMatch(formatUsageReply(snapshot, '今日用量'), /累计/);
  assert.doesNotMatch(formatUsageReply(snapshot, '累计费用'), /今日/);
  assert.match(formatUsageReply(snapshot, '今日输入输出明细'), /输入.*输出.*缓存/);
});

test('unknown model usage is visibly unpriced, not presented as free', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qq-price-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = await openUsageLedger(dir);
  const call = ledger.start('not-in-price-table');
  call.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 } }));
  await call.finish('completed');
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.total.unpricedTokens, 110);
  assert.match(formatUsageReply(snapshot), /费用待定/);
  assert.equal(formatEstimatedCost({ estimatedUsd: 0.000001, totalTokens: 1, unpricedTokens: 0 }), '约 <¥0.0001');
});

test('GPT-6.1 Sol uses its own cached-input rate and remains an API-equivalent estimate',()=>{
  assert.equal(estimateTokenCost('gpt-6.1-sol',{inputTokens:1000000,cachedInputTokens:800000,outputTokens:100000}),1.48);
  assert.equal(pricingInfo.modelCheckedAt['gpt-6.1-sol'],'2026-10-14');
});

test('CNY uses the dated reference rate once, including zero and partial estimates', () => {
  assert.equal(usdToCny(1), 6.7489);
  assert.equal(pricingInfo.exchangeRate.date, '2026-09-24');
  assert.equal(formatEstimatedCost({ estimatedUsd: 0, totalTokens: 0 }), '约 ¥0.0000');
  assert.equal(formatEstimatedCost({ estimatedUsd: 1, estimatedCny: 6.7489, totalTokens: 20, unpricedTokens: 10 }), '已计价部分约 ¥6.7489');
});

test('fee queries are recognized without hijacking unrelated shopping or secrets', () => {
  for (const q of ['狐宫静，今日费用', '狐宫静你今天花了多少钱', '/累计费用', '这些 token 大概花了多少钱']) assert.equal(isUsageQuestion(q), true, q);
  for (const q of ['今天买菜花了多少钱', '告诉我 access token 密钥']) assert.equal(isUsageQuestion(q), false, q);
});
