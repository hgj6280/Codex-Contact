import {LOCAL_TEXT_MODEL,LOCAL_SYSTEM_PROMPT} from './qq-local-model.mjs';
import {roles,callMetadata,modelObservation,splitInput} from './qq-observability.mjs';
import {referenceCost} from './qq-reference-pricing.mjs';
import { mkdir, readFile, readdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { estimateTokenCost, formatEstimatedCost, pricingInfo, usdToCny } from './qq-token-pricing.mjs';

const zone = 'Asia/Shanghai';
const dayOf = date => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
const empty = () => ({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, calls: 0, recordedCalls: 0, pendingCalls: 0, incompleteCalls: 0, estimatedUsd: 0, unpricedTokens: 0 });
const count = value => Number.isSafeInteger(value) && value >= 0;

export function normalizeUsage(usage) {
  if (!usage || !['input_tokens', 'output_tokens', 'cached_input_tokens'].every(k => count(usage[k]))) return null;
  if (usage.cached_input_tokens > usage.input_tokens) return null;
  const totalTokens = usage.input_tokens + usage.output_tokens;
  if (!Number.isSafeInteger(totalTokens)) return null;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cachedInputTokens: usage.cached_input_tokens, totalTokens };
}

// Incremental JSONL parser: independent of the server's truncated stdout log.
export function createUsageTracker(onUsage,onEvent) {
  let buffer = '', dropping = false, completed = false, turn = 0;
  const consume = line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if(!event||typeof event!=='object')return;
    onEvent?.(event);
    if (event.type === 'turn.started') { completed = false; turn++; }
    if (event.type !== 'turn.completed' || completed) return;
    const usage = normalizeUsage(event.usage);
    if (!usage) return;
    completed = true;
    const tier=event.service_tier || event.response?.service_tier;
    onUsage(typeof tier==='string'?{...usage,serviceTier:tier}:usage, turn,event.usage.input_tokens_details?.image_tokens??event.usage.image_tokens);
  };
  return {
    write(chunk) {
      // Never hold large image payloads or tool output in the usage parser.
      for (const part of String(chunk).split(/(?<=\n)/)) {
        if (!dropping) {
          buffer += part;
          if (buffer.length > 1024 * 1024) { buffer = ''; dropping = true; }
        }
        if (part.endsWith('\n')) {
          if (!dropping) consume(buffer.trim());
          buffer = ''; dropping = false;
        }
      }
    },
    end() { if (!dropping && buffer.trim()) consume(buffer.trim()); buffer = ''; }
  };
}

async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
  } finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

export async function openUsageLedger(directory, { now = () => new Date() } = {}) {
  const recordsDir = join(directory, 'calls');
  await mkdir(recordsDir, { recursive: true, mode: 0o700 });
  const metaPath = join(directory, 'meta.json');
  let meta;
  try { meta = JSON.parse(await readFile(metaPath, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    meta = { version: 1, startedAt: now().toISOString(), timeZone: zone };
    await atomicJson(metaPath, meta);
  }
  let billingPolicy=null;
  try{billingPolicy=JSON.parse(await readFile(join(directory,'billing-policy.json'),'utf8'));if(billingPolicy.version!==1||!Number.isFinite(Date.parse(billingPolicy.startedAt))||billingPolicy.name!=='DeepSeek V4.1 Flash'||![billingPolicy.inputUsd,billingPolicy.cachedUsd,billingPolicy.outputUsd].every(n=>Number.isFinite(n)&&n>=0))throw Error('Invalid billing policy');}catch(e){if(e.code!=='ENOENT')throw e;}
  const records = new Map();
  let lastError = null;
  for (const name of await readdir(recordsDir)) {
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    try {
      const record = JSON.parse(await readFile(join(recordsDir, name), 'utf8'));
      if (name !== `${record.id}.json` || !Array.isArray(record.turns) || !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.updatedAt)) || record.turns.some(t => !['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens'].every(k => count(t[k])))) throw new Error('Invalid usage record');
      if (record.status === 'running') {
        record.status = 'interrupted';
        await atomicJson(join(recordsDir, name), record);
      }
      records.set(record.id, record);
    } catch { lastError = '部分历史用量记录读取失败；合计可能不完整。'; }
  }
  return {
    start(model,{serviceTier='default',...options}={}) {
      const id = randomUUID();
      const meta=callMetadata({...options,systemBytes:model===LOCAL_TEXT_MODEL?Buffer.byteLength(LOCAL_SYSTEM_PROMPT):0});
      const record = { version: 2, id, model, serviceTier, ...meta, firstOutputAt:null,lastOutputAt:null, startedAt: now().toISOString(), updatedAt: now().toISOString(), status: 'running', turns: [] };
      records.set(id, record);
      let queue = Promise.resolve();
      const persist = () => {
        const snapshot = structuredClone(record);
        queue = queue.then(() => atomicJson(join(recordsDir, `${id}.json`), snapshot)).catch(error => {
          lastError = '用量记录写入失败；统计可能不完整，请检查本机存储。';
          console.warn('QQ usage persistence failed:', error.message);
        });
        return queue;
      };
      persist();
      function observe({first=null,last=null}={}){
        if(first!=null)record.firstOutputAt??=first;
        if(last!=null)record.lastOutputAt=last;
        modelObservation(meta,{first,last});
      }
      function classify(text){
        if(meta.role!=='reply'||typeof text!=='string')return;
        const answer=text.trim();
        if(/^\[\[qq_(?:context_more|recall:[^\]\n]+)\]\]$/.test(answer))record.role=meta.role='context';
        else if(/^\[\[qq_sticker:[^\]\n]+\]\]$/.test(answer))record.role=meta.role='sticker';
        else if(/\[\[qq_sticker:/.test(answer)||/"sticker"\s*:\s*"[^"]+"/.test(answer))record.sharedRoles=['sticker'];
      }
      const tracker = createUsageTracker((usage, turn, imageTokens) => {
        // Additional agent turns can contain hidden tool output. Only the first
        // submitted payload has visible composition for attribution.
        const inputParts=splitInput(usage.inputTokens,record.turns.length?{...meta,visibleBytes:null}:meta,imageTokens);
        record.turns.push({ ...usage, turn,inputParts,retryInputTokens:meta.retry?usage.inputTokens:0 });
        record.updatedAt = now().toISOString();
        persist();
      },event=>{
        if(event.type==='item.updated'&&event.item?.type==='agent_message'&&event.item.text)observe({first:Date.now()});
        if(event.type==='item.completed'&&event.item?.type==='agent_message'){classify(event.item.text);observe({last:Date.now()});}
      });
      let finished = false;
      return {
        observe,classify,
        write: chunk => tracker.write(chunk),
        async finish(status) {
          if (finished) return queue;
          finished = true;
          tracker.end();
          record.status = status;
          record.updatedAt = now().toISOString();
          return persist();
        }
      };
    },
    snapshot({breakdown=false}={}) {
      const todayDate = dayOf(now());
      const total = empty(), today = empty();
      const roleTotals=()=>Object.fromEntries(roles.map(role=>[role,{calls:0,inputTokens:0,outputTokens:0,cachedInputTokens:0,retryInputTokens:0,sharedCalls:0,unknownUsageCalls:0,imagesUnknownCalls:0,inputParts:{rules:0,history:0,images:0,other:0,unattributed:0}}]));
      const byRole=breakdown?{today:roleTotals(),total:roleTotals()}:null;
      for (const record of records.values()) {
        const useReference=billingPolicy&&Date.parse(record.startedAt)>=Date.parse(billingPolicy.startedAt);
        const buckets = dayOf(record.updatedAt) === todayDate ? [total, today] : [total];
        const role=roles.includes(record.role)?record.role:'unclassified';
        if(breakdown)for(const totals of buckets.length===2?[byRole.total,byRole.today]:[byRole.total]){
          const part=totals[role];part.calls++;
          for(const shared of record.sharedRoles||[])if(shared!==role&&roles.includes(shared))totals[shared].sharedCalls++;
          if(!record.turns.length)part.unknownUsageCalls++;
          if(record.turns.some(t=>t.inputParts?.images===null))part.imagesUnknownCalls++;
          for(const turn of record.turns){
            for(const field of ['inputTokens','outputTokens','cachedInputTokens','retryInputTokens'])part[field]+=turn[field]||0;
            for(const field of Object.keys(part.inputParts))part.inputParts[field]+=turn.inputParts?.[field]??(field==='unattributed'&&!turn.inputParts?turn.inputTokens:0);
          }
        }
        for (const bucket of buckets) {
          bucket.calls++;
          if (record.turns.length) bucket.recordedCalls++;
          if (record.status === 'running') bucket.pendingCalls++;
          else if (record.status !== 'completed' || !record.turns.length) bucket.incompleteCalls++;
          for (const usage of record.turns) {
            for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens']) bucket[key] += usage[key];
            const cost = useReference ? referenceCost(usage,record.startedAt,billingPolicy) : estimateTokenCost(record.model, usage,{serviceTier:usage.serviceTier || record.serviceTier || 'default'});
            if (cost == null) bucket.unpricedTokens += usage.totalTokens;
            else bucket.estimatedUsd += cost;
          }
        }
      }
      for (const bucket of [today, total]) bucket.estimatedCny = usdToCny(bucket.estimatedUsd);
      return { ...(breakdown?{byRole}:{}), startedAt: meta.startedAt, historicalStartedAt:meta.startedAt, billingPolicy, timeZone: zone, todayDate, today, total, lastError, pricing: billingPolicy?{...pricingInfo,source:billingPolicy.source,checkedAt:billingPolicy.checkedAt,referenceModel:billingPolicy.name,referenceRatesUsdPerMillion:{input:billingPolicy.inputUsd,cached:billingPolicy.cachedUsd,output:billingPolicy.outputUsd},tier:billingPolicy.peakValley?"peak-valley-reference":"off-peak-reference"}:pricingInfo };
    }
  };
}

export function isUsageQuestion(text) {
  const compact = String(text || '').replace(/\[CQ:[^\]]*\]/g, '').replace(/\s+/g, '').toLowerCase();
  if (/^(?:狐宫静[，,:：]?)?(?:你)?\/?(?:(?:今日|今天|累计|总)费用|费用统计|用量费用|(?:今日|今天|累计|总共)?花了多少钱)[？?。!！]*$/.test(compact)) return true;
  if (/^(?:狐宫静[，,:：]?)*\/?(?:今日用量|今天用量|累计用量|总用量|用量统计|用量|token统计|token用量|tokens?|usage)[？?。!！]*$/.test(compact)) return true;
  return /(?:token|令牌|用量)/i.test(compact) && /多少|统计|查询|用了|用掉|消耗|查看|查一下|查查|剩余/.test(compact)
    && !/密钥|密码|凭证|api.?key|access.?token|配置文件/.test(compact);
}

export function formatUsageReply(snapshot, question = '', {compact=false}={}) {
  const n = value => value.toLocaleString('en-US');
  const row = (label, s) => compact&&!/token|用量|输入|输出|缓存|明细/i.test(question) ? `${label}${formatEstimatedCost(s)}` : `${label} ${n(s.totalTokens)} token，${formatEstimatedCost(s)}`;
  const todayOnly = /今日|今天/.test(question) && !/累计|总共|总用量/.test(question);
  const totalOnly = /累计|总共|总用量/.test(question) && !/今日|今天/.test(question);
  const selected = todayOnly ? [['今日', snapshot.today]] : totalOnly ? [['累计', snapshot.total]] : [['今日', snapshot.today], ['累计', snapshot.total]];
  const warning = snapshot.lastError ? '统计异常，可能不完整' : snapshot.total.incompleteCalls || snapshot.total.pendingCalls ? '部分用量未返回' : '';
  return [
    selected.map(([label, counts]) => row(label, counts)).join('；') + '。',
    /明细|输入|输出|缓存/.test(question) ? selected.map(([label, s]) => `${label}输入 ${n(s.inputTokens)}／输出 ${n(s.outputTokens)}／缓存 ${n(s.cachedInputTokens)}（已含在输入）`).join('；') : '',
    !compact ? `${snapshot.billingPolicy?`按 DeepSeek V4.1 Flash ${snapshot.billingPolicy.peakValley?'峰谷':'低峰'}价等价估算`:'API 等价估算'}，非实际扣款；不含生图等附加费${warning ? `；${warning}` : ''}。` : '',
  ].filter(Boolean).join('\n');
}

// Record each provider invocation, including retries and tool-directed re-queries.
export function withUsageLedger(reply,{ledger,model,role='reply',retry=false}){
 return async (...args)=>{
  const tracker=ledger.start(model,{role,retry,prompt:args[0]});
  try{const result=await reply(...args),u=result.usage;
   tracker.classify?.(result.text);
   tracker.observe?.({first:result.localTiming?.firstOutputAt,last:result.localTiming?.lastOutputAt??Date.now()});
   if(u&&u.available!==false)tracker.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:u.prompt_tokens,output_tokens:u.completion_tokens,cached_input_tokens:u.prompt_tokens_details?.cached_tokens||0,image_tokens:u.prompt_tokens_details?.image_tokens}})+'\n');
   await tracker.finish('completed');return result;
  }catch(e){await tracker.finish('failed');throw e;}
 };
}
