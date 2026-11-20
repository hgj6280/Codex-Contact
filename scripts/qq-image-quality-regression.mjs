// Real Codex CLI pipeline regression. Generates a new image, validates it,
// performs up to two guided edits, and saves the same validation_report as Hub.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexImageTracker } from '../src/qq-codex-images.mjs';
import { codexRuntimePaths } from '../src/codex-runtime-paths.mjs';
import { ensureCharacterCache } from '../src/qq-character-cache.mjs';
import { createCliDiagnostics } from '../src/qq-cli-diagnostics.mjs';
import {readImageReferenceWithRetry} from '../src/qq-image-preflight.mjs';
import { buildReferenceSpecPrompt, parseReferenceSpec, buildDetailedReviewPrompt, buildTextConfirmationPrompt,
  validateGeneratedImages, writeValidationReport, ocrImage } from '../src/qq-image-quality.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [request, ...provided] = process.argv.slice(2);
const candidateFlag = provided.find(arg => arg.startsWith('--candidate='));
const modelFlag = provided.find(arg => arg.startsWith('--model='));
const ocOnly = provided.includes('--oc-only');
const noReference = provided.includes('--no-reference');
const fast = provided.includes('--fast');
const suppliedCandidate = candidateFlag ? resolve(candidateFlag.slice('--candidate='.length)) : null;
const imageInputs = provided.filter(arg => !arg.startsWith('--'));
const local = codexRuntimePaths();
if (!request || (!imageInputs.length && !ocOnly && !noReference) || (ocOnly && noReference)) {
  console.error('Usage: node scripts/qq-image-quality-regression.mjs "生成要求" source.png [identity.png] [--candidate=previously-generated.png]');
  process.exitCode = 2;
} else {
  if (ocOnly) await ensureCharacterCache(join(root,'assets','qq-character','hugongjing'),local.character);
  const sources = ocOnly || noReference ? [] : [resolve(imageInputs[0])], identities = ocOnly
    ? [join(local.character,'reference-default.png')] : imageInputs[1] ? [resolve(imageInputs[1])] : [];
  const recordId = randomUUID(), outputDir = local.replies;
  await mkdir(outputDir, { recursive: true });
  const model = modelFlag ? modelFlag.slice('--model='.length) : 'gpt-6-sol';
  async function run(kind, prompt, images, generate = false, {timeoutMs}={}) {
    const output = join(outputDir, `${recordId}-${kind}-${randomUUID()}.txt`);
    const args = ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--ignore-rules',
      generate ? '--enable' : '--disable', 'image_generation', '--json', '-s', 'read-only', '-m', model,
      '-c', 'model_reasoning_effort="low"', '-C', local.workspace, '-o', output,
      ...(fast?['-c','features.fast_mode=true','-c','service_tier="fast"']:[]),
      ...images.flatMap(path => ['--image', path]), '-'];
    const tracker = generate ? createCodexImageTracker(join(process.env.HOME, '.codex'),{archive:{
      directory:join(process.env.HOME,'Downloads','AI群友生图'), metadataDirectory:reportDir,
      context:{request,model,regression:true,stage:kind}
    }}) : null;
    const diagnostic=createCliDiagnostics(), startedAt=Date.now();let stderr='';
    console.log(JSON.stringify({stage:kind,status:'started',reportId:recordId}));
    try { await new Promise((resolveRun, reject) => {
      const child = spawn(process.env.CODEX_CLI_PATH || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', args, { stdio: ['pipe','pipe','pipe'] });
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGTERM'); reject(Object.assign(new Error(`${kind} timeout`),{code:'MODEL_TIMEOUT'})); } }, timeoutMs || (generate ? 600000 : 120000));
      child.stdout.on('data', chunk => {tracker?.write(chunk);diagnostic.write(chunk);});
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      child.on('close', code => { if (!settled) { settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`${kind} exit ${code}: ${stderr}`)); } });
      child.stdin.end(prompt);
    });
    } catch(error) {
      (report.cliRuns ||= []).push({stage:kind,...diagnostic.finish({status:'failed',stderr,durationMs:Date.now()-startedAt}),error:error.message});
      await persist(report);throw error;
    }
    (report.cliRuns ||= []).push({stage:kind,...diagnostic.finish({status:'completed',code:0,stderr,durationMs:Date.now()-startedAt})});
    await persist(report);
    return generate ? { images: await tracker.collect(), text: await readFile(output, 'utf8') } : { images: [], text: await readFile(output, 'utf8') };
  }
  const sourceOcr = await Promise.all(sources.map(path => ocrImage(path).catch(error => ({ words: [], text: '', confidence: 0, error: error.message }))));
  const report = { version: 1, id: recordId, createdAt: new Date().toISOString(), originalRequest: request,
    referencePaths: sources, identityPaths: identities, model, serviceTier:fast?'fast':'default',status: 'preflight', rounds: [], initialImages: [] };
  if (suppliedCandidate) report.regressionCandidate = suppliedCandidate;
  const reportDir = join(root, 'data', 'qq-image-archive');
  const persist = async value => writeValidationReport(reportDir, value);
  await persist(report);
  try {
    const preflight=await readImageReferenceWithRetry({
      read:async(attempt,context)=>(await run(`spec-${attempt}`,buildReferenceSpecPrompt({request,references:sources,identities,sourceOcr}),[...sources,...identities],false,context)).text,
      parse:text=>parseReferenceSpec(text,{request,references:sources,identities}),
      onAttempt:async row=>{(report.preflightAttempts ||= []).push(row);await persist(report);}});
    if(preflight.error)throw new Error(preflight.error);
    const expected=preflight.spec;
    report.expected = expected; report.sourceOcr = sourceOcr; await persist(report);
    const genPrompt = [
      `用户要求：${request}`,
      `独立提取的参考图文字与姿势：${JSON.stringify(expected)}。`,
      sources.length ? `第 1 张是构图、动作、文字参考；${identities.length ? '第 2 张是 OC 身份与服装参考。' : '保留原角色身份。'}`
        : identities.length ? '附图仅为狐宫静 OC 身份与服装参考，不是动作模板。根据用户要求新创作，不照搬身份图姿势。' : '没有参考图或固定 OC，完全按本次要求的人物和场景新创作，不自动换成机器人角色。',
      sources.length || identities.length
        ? `调用 image_gen 并传入 referenced_image_paths: ${JSON.stringify([...sources, ...identities])}。请实际生成新图。文字必须逐字准确，左右手及道具位置必须按原图，身份图不改变原图动作。`
        : '实际调用 image_gen 生成新图，不传 referenced_image_paths 或 num_last_images_to_include。'
    ].join('\n');
    report.initialPrompt = genPrompt; await persist(report);
    const generated = suppliedCandidate
      ? { images: [suppliedCandidate], text: 'Using a previously generated real image as the first candidate.' }
      : await run('generate', genPrompt, [...sources, ...identities], true);
    if (!generated.images.length) throw new Error(`Generation returned no image: ${generated.text.slice(0, 1000)}`);
    report.initialImages = generated.images; await persist(report);
    const result = await validateGeneratedImages({ report, candidates: generated.images, expected, sourceOcr, persist,confirmBeforeRepair:true,confirmFinalFailure:true,
      review: async ({ candidate, candidateOcr, priorRounds, confirmationReview,readRetry }) => (await run(confirmationReview ? 'review-confirm' : 'review', buildDetailedReviewPrompt({
        request, references: sources, identities, candidate, expected, sourceOcr, candidateOcr, confirmationReview,
        priorPassed: priorRounds.flatMap(r => r.entries.flatMap(e => e.checks ? Object.entries(e.checks).filter(([,c]) => c.status === 'PASS').map(([key]) => key) : []))
      }), [...sources, ...identities, candidate],false,readRetry)).text,
      confirmText: async ({ candidate, candidateOcr, expected, confirmationReview,readRetry }) => (await run('text-confirm', buildTextConfirmationPrompt({
        expected, reference: sources, candidate, sourceOcr, candidateOcr, confirmationReview
      }), [...sources, candidate],false,readRetry)).text,
      repair: async ({ candidate, plan, prompt, round }) => {
        const images = plan.mode === 'edit' ? [candidate, ...sources, ...identities] : [...sources, ...identities];
        const response = await run(`repair-${round + 1}`, prompt, images, true);
        return response.images;
      }
    });
    console.log(JSON.stringify({ report: join(reportDir, `validation_report-${report.id}.json`), status: result.reason,
      expectedText: expected.expectedText, initialImages: generated.images, delivered: result.paths,
      rounds: report.rounds.map(r => ({round: r.round, entries: r.entries.map(e => ({candidate:e.candidate,status:e.status,
        failures: Object.entries(e.checks || {}).filter(([,c])=>c.status==='FAIL').map(([category,c])=>({category,issue:c.issue})),
        retry:e.retry,repairMode:e.repairMode,repairPromptSaved:Boolean(e.repairPrompt)}))})) }, null, 2));
  } catch (error) {
    report.status = 'error'; report.error = error.message; await persist(report);
    console.error(JSON.stringify({report:join(reportDir, `validation_report-${report.id}.json`),error:error.message}));
    process.exitCode = 1;
  }
}
