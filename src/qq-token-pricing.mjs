// Official Standard / short-context USD prices per 1M tokens, checked 2026-09-25.
// Model-specific sources: https://developers.openai.com/api/docs/models/<model>
// These are API-equivalent estimates, not the user's Codex subscription bill.
export const pricingInfo = {
  checkedAt: '2026-09-25', currency: 'CNY', baseCurrency: 'USD', tier: 'standard-short-context',
  exchangeRate: {
    usdToCny: 6.7489, date: '2026-09-24',
    source: 'https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do'
  },
  source: 'https://developers.openai.com/api/docs/pricing',
  modelCheckedAt: {'gpt-6.1-sol':'2026-10-14'},
  exclusions: '不含生图、工具、缓存写入溢价、长上下文及其他附加费用'
};
const rates = {
  'gpt-6-luna': [0.10, 0.01, 0.50],
  // GPT-6.1 Sol official Standard API-equivalent prices, checked 2026-10-14.
  'gpt-6.1-sol': [2, 0.10, 10],
  'gpt-6-sol': [2, 0.20, 10],
  'gpt-6-astra': [10, 1, 50],
  'gpt-5.6-luna': [0.20, 0.02, 1.20],
  'gpt-5.6-terra': [2, 0.20, 12],
  'gpt-5.6-sol': [4, 0.40, 20],
  'gpt-5.5': [5, 0.50, 30]
};

export function estimateTokenCost(model, usage, {serviceTier='default'}={}) {
  if(!['default','auto','fast','priority'].includes(serviceTier))return null;
  const rate = Object.hasOwn(rates, model) ? rates[model] : null;
  if (!rate) return null; // Never silently charge an unknown model at another model's rate.
  const { inputTokens, cachedInputTokens, outputTokens } = usage;
  if (![inputTokens, cachedInputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0) || cachedInputTokens > inputTokens) return null;
  return ((inputTokens - cachedInputTokens) * rate[0] + cachedInputTokens * rate[1] + outputTokens * rate[2]) / 1e6 * (['fast','priority'].includes(serviceTier)?2:1);
}

// Keep ledger estimates in USD; convert once at presentation time without rounding.
export const usdToCny = usd => usd * pricingInfo.exchangeRate.usdToCny;

export function formatEstimatedCost(counts) {
  if (counts.unpricedTokens && counts.unpricedTokens === counts.totalTokens) return '费用待定';
  const amount = counts.estimatedCny ?? usdToCny(counts.estimatedUsd || 0);
  const value = amount > 0 && amount < 0.0001 ? '<¥0.0001' : `¥${amount.toFixed(4)}`;
  return `${counts.unpricedTokens ? '已计价部分' : ''}约 ${value}`;
}
