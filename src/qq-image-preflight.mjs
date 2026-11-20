export const safeImageError = error => String(error?.message || error || 'Unknown reference preparation error')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/([?&](?:rkey|token|access_token)=)[^&\s"']+/gi, '$1[redacted]').slice(0,4000);

export function classifyImagePreflightFailure(error) {
  const message = [safeImageError(error),...(error?.cliDiagnostics?.events || []).map(event=>safeImageError(event.error || ''))].join('\n');
  // Never retry an explicit access restriction, account failure or safety refusal.
  if (/\b451\b|no_biscuit_no_service|unsupported.{0,20}(?:country|region)|access denied|permission denied/i.test(message)) return 'access';
  if (/\b(?:401|403)\b|unauthorized|authentication|invalid.{0,10}token|token.{0,10}expired|login required/i.test(message)) return 'authentication';
  if (/\b429\b|rate limit|too many requests|quota|usage limit/i.test(message)) return 'quota';
  if (/safety|policy refusal|content policy|not allowed/i.test(message)) return 'safety';
  if (error?.code === 'REFERENCE_SPEC_INVALID') return 'invalid-output';
  if (/workspace routing discovery failed|connection failed|error sending request|request timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|transport channel closed|tls handshake eof|stream disconnected|peer closed connection|TLS close_notify/i.test(message)) return 'connection';
  if (error?.code === 'MODEL_TIMEOUT') return 'timeout';
  return 'unknown';
}

// Only the read-only preparation step retries. Never run a second image
// generation here: an uncertain tool result could already have produced a file.
export async function readImageReferenceWithRetry({ read, parse, onAttempt = async () => {}, wait = ms => new Promise(resolve => setTimeout(resolve,ms)), maxAttempts = 3, budgetMs = 200000, now = Date.now }) {
  const attempts = [];
  const deadline = now() + budgetMs;
  let previousCategory = null;
  for (let attempt = 1; attempt <= Math.min(3, maxAttempts); attempt++) {
    const started = now();
    let spec, error;
    try {
      spec = parse(await read(attempt, {retryReason:previousCategory, timeoutMs:Math.max(1,Math.min(120000,deadline-started))}));
      if (!spec) throw Object.assign(new Error('Reference preparation returned an invalid structured result'), {code:'REFERENCE_SPEC_INVALID'});
    } catch (caught) { error = caught; }
    const category = error ? classifyImagePreflightFailure(error) : null;
    const row = {attempt,status:error?'failed':'completed',category,durationMs:now()-started,error:error?safeImageError(error):null};
    attempts.push(row);
    await onAttempt(row);
    if (!error) return {spec,attempts,error:null,category:null};
    // Read-only stages can safely recover a broken connection, timeout or one
    // malformed JSON response. Never retry auth, safety, quota or file errors.
    const delay = attempt === 1 ? 750 : 2000;
    const retryable = ['connection','timeout','invalid-output'].includes(category);
    if (!retryable || attempt === Math.min(3,maxAttempts) || (category === 'invalid-output' && attempt >= 2) || now()+delay >= deadline)
      return {spec:null,attempts,error:safeImageError(error),category};
    previousCategory = category;
    await wait(delay);
  }
}

export function formatImagePreflightFailure(result) {
  if (result.category === 'connection') return result.attempts.length > 1
    ? `生图前连接模型服务失败，已自动重试 ${result.attempts.length-1} 次仍未连上，暂时没有生成图片。请稍后再试；不需要重发参考图。`
    : '生图前暂时连不上模型服务，没有生成图片。请稍后再试。';
  if (result.category === 'authentication') return '生图模型的登录授权失效或被拒绝，暂时没有生成图片，需要检查 Codex 登录状态。';
  if (result.category === 'access') return '生图模型服务拒绝了访问，暂时没有生成图片。后台已记录原因，需要检查服务访问权限。';
  if (result.category === 'quota') return '生图模型当前额度或请求频率受限，暂时没有生成图片，请稍后再试。';
  if (result.category === 'timeout') return '生图前的看图检查超时了，暂时没有生成图片，后台已记录原因。';
  if (result.category === 'invalid-output') return '读图结果格式不完整，暂时没有生成图片，后台已记录原因。';
  return '生图前的读图检查失败，暂时没有生成图片，后台已记录原因。';
}
