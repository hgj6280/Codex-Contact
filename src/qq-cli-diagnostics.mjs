const clean = value => String(value ?? '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/([?&](?:rkey|token|access_token)=)[^&\s"']+/gi, '$1[redacted]')
  .replace(/((?:api_key|access_token|authorization)\s*[=:]\s*)[^\s,}]+/gi, '$1[redacted]')
  .replace(/[A-Za-z0-9+/=]{500,}/g, '[binary omitted]').slice(0,4000);

export function createCliDiagnostics() {
  let pending = '', imageToolAttempted = false, threadId = null;
  const events = [];
  function parse(line) {
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'thread.started') threadId = event.thread_id;
    const item = event.item || {};
    const tool = [item.type, item.tool, item.tool_name, item.name, item.server].filter(Boolean).join(' ');
    if (/image[_ .-]?(?:gen|generation)/i.test(tool)) imageToolAttempted = true;
    if (/error|failed/.test(event.type || '') || /tool|image|command/.test(item.type || '') || item.error) {
      events.push({type:event.type, itemType:item.type, tool:clean(tool), status:item.status,
        error:clean(event.message || event.error?.message || item.error?.message || item.error || ''),
        detail:clean(item.result?.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n') || item.aggregated_output || '')});
      if (events.length > 40) events.shift();
    }
  }
  return {
    write(chunk) {
      pending += chunk;
      let index;
      while ((index = pending.indexOf('\n')) >= 0) { parse(pending.slice(0,index)); pending = pending.slice(index+1); }
      if (pending.length > 2*1024*1024) pending = '';
    },
    finish({status, code, stderr = '', durationMs, generatedImageCount = 0}) {
      if (pending.trim()) parse(pending); pending = '';
      // Native image calls are not always exposed in the exec JSON stream.
      // A generated file proves execution; false only means no observed call.
      const blockingStderr = clean(stderr.split('\n').filter(line => line.trim()
        && line.trim() !== 'Reading prompt from stdin...'
        && !/WARN codex_rollout::list: state db discrepancy .*falling_back\s*$/.test(line)).join('\n'));
      const providerErrors=[blockingStderr,...events.map(e=>e.error)].join('\n');
      const imageFailureObserved=/image generation failed:/i.test(providerErrors);
      const safetyBlocked=/moderation_blocked|image_generation.*(?:content_policy_violation|safety)/i.test(providerErrors);
      const safetyCategory=safetyBlocked&&/public-figure/.test(providerErrors)?'public-figure':null;
      const connectionFailure=status!=='completed'&&!imageToolAttempted&&generatedImageCount===0&&
        /workspace routing discovery failed|failed to refresh available models: request timed out|error sending request for url|ECONNRESET|TLS connection/i.test([blockingStderr,...events.map(e=>e.error)].join('\n'));
      return {status, code, durationMs, threadId, imageToolAttempted:imageToolAttempted || imageFailureObserved || generatedImageCount > 0,
        failureKind:safetyBlocked?'safety':connectionFailure?'connection':null,
        ...(safetyBlocked?{providerError:'moderation_blocked',safetyCategory}:{}),
        toolVisibility:'exec-json-and-artifacts', generatedImageCount, events:[...events], stderr:clean(stderr), blockingStderr};
    }
  };
}

export function missingImageFailureReply(diagnostic){
  if(diagnostic?.failureKind==='safety')return diagnostic.safetyCategory==='public-figure'
    ?'这次生图被上游图片服务拒绝：服务将参考内容判为涉及公众人物，没有生成图片。具体错误已记录。'
    :'这次生图被上游图片服务的安全检查拒绝，没有生成图片。具体错误已记录。';
  return '这次生图没有产出图片，失败原因已记录。';
}

// Do not retry safety refusals, exhausted quotas, or unknown image-tool failures.
export function mayRetryMissingImage(diagnostic) {
  return diagnostic?.status === 'completed' && diagnostic.imageToolAttempted === false &&
    !diagnostic.events?.some(e=>e.error || /failed|error/i.test(e.status || e.type || '')) && !(diagnostic.blockingStderr ?? diagnostic.stderr);
}

export function buildMissingImageRetryPrompt({request, inputs, expected}) {
  return [
    '本次任务是实际生图，不是写一条聊天回复。上一轮没有取得新生成的成品文件。',
    `原始要求：${JSON.stringify(request)}。身份与验收要求：${JSON.stringify(expected)}。`,
    `请查看本次输入图片，再调用 image_gen；referenced_image_paths 必须为 ${JSON.stringify(inputs)}。`,
    '没有用户动作原图时，身份图只决定角色长相，按用户要求自由构图，不照搬身份图姿势。',
    '遵守安全限制；如果不能生成，明确说明原因，不换词绕过限制。不要输出已有图路径、qq_image 标记或假装已完成。'
  ].join('\n');
}
