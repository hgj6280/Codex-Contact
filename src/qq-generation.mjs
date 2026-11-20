import { loadQqCharacter } from './qq-character.mjs';
import {parseQqImageRequest} from './qq-image-request.mjs';

export function resolveGenerationIdentity(text) {
  return parseQqImageRequest(text).identity;
}

export function requestsHugongjingOc(text) {
  return resolveGenerationIdentity(text).useOc;
}

export function collectGenerationReferences(event) {
  const result = [], seen = new Set();
  for (const [source, images] of [['当前消息', event.images], ['引用消息', event.replyContext?.images]]) {
    for (const image of Array.isArray(images) ? images : []) {
      const key = image.file || image.url;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      result.push({ ...image, referenceSource: source });
    }
  }
  return result;
}

export function buildStrictReferencePrompt(paths, inputs, identityPaths = [], identityName='狐宫静') {
  if (!paths.length) return '';
  return [
    '【本次生图的强参考约束，优先于默认角色描述与历史聊天画面】',
    '用户明确提供了参考图片。必须做基于原图的编辑/参考生成，不得仅凭文字概括重新设计一张相似主题的图。',
    '输入图与实际本地文件按相同顺序一一对应：',
    ...paths.map((path, i) => `参考图 ${i + 1}（${inputs[i]?.referenceSource || '用户提供'}）：${JSON.stringify(path)}`),
    ...identityPaths.map((path, i) => `参考图 ${paths.length + i + 1}（${identityName} OC 身份设定，不是动作模板）：${JSON.stringify(path)}`),
    `实际调用 image_gen 时必须传入 referenced_image_paths: ${JSON.stringify([...paths, ...identityPaths])}；不能只在 prompt 里提到“参考图”而不把这些文件传给生图工具。不要同时传 num_last_images_to_include。`,
    '生图前仔细查看每张参考图。先确定“必须保持的细节”和“用户允许改动的部分”，把两者明确写进给生图工具的 prompt。多张图按用户指定分工；没有指定时以第 1 张为主，不混合互相冲突的人物/服装/姿势；存在无法判断的冲突先简短询问。',
    '【先读图再生成】实际调用 image_gen 的 prompt 必须包含三份具体清单，不能仅写“严格参考”：①逐字抄录原图全部文字（含标点、大小写、省略号、换行及位置），用引号包住原文，未要求改字就一字不改；任何字看不清先问用户，不猜、不润色、不换成角色口头禅。②分别描述人物左右手位置、前后遮挡、是否交叉、手掌/手指/持物、腿部、头部和躯干朝向。③列出用户允许改变的部分，其余锁定。禁止只用“威严/可爱/生气”等情绪词代替具体姿势。',
    '不要把原图文字意译为新的梗；例如“网警巡视中...”不能变成“别惹我...”。双手背在身后绝不能变成胸前抱臂。以上只是防错示例，不是让每张图片都加这些字或改成这些姿势；本次具体内容只能从本次原图读取。',
    identityPaths.length
      ? identityName!=='狐宫静'?`使用已录入角色 ${JSON.stringify(identityName)} 的身份图替换模板人物，严格保持该角色发色、眼睛、耳尾及服装饰品，不得变成狐宫静；用户明确要求换装除外。`:'用户明确要求使用狐宫静的 OC（“给狐宫静生成这个图”就是角色替换，不是单纯称呼机器人）。必须用后附身份图中的狐宫静替换原图人物：浅金发带桃橙发梢、红眼、狐耳狐尾、蓝色蝴蝶结、花与爱心发夹、金铃铛及默认服装以 OC 为准；用户明确要求换装的部分除外。不要保留原图角色的发色、瞳色或身份，不得凭名字另设计一个狐娘。'
      : '必须保持：原角色身份和脸型、发型发色、眼睛颜色、耳尾和饰品、服装结构与配色、人物数量、身体比例、手势与姿态、表情、镜头角度、构图位置、画幅比例、背景和画风线条；除非用户明确要求改变其中某项。可见文字原样保留，除非要求换字或去字。',
    identityPaths.length
      ? '用户原图仅负责动作、表情、构图、镜头、画幅、画风和文字，严格沿用这些特征（明确要求修改的除外）；身份图仅负责 OC 长相及服饰，不能把身份图的站姿或背景照搬进来。只执行明确要求的变化，不擅自裁切、翻转、换背景或改字。'
      : '只执行明确要求的局部变化；不要擅自换角色、加狐耳或配饰、美化重构、改变姿势/背景、裁掉主体、镜像翻转或把二维原图重绘成其他画风。仅改变表情/文字时，其余区域尽量维持原图。',
    '用户说“严格参考/照原图/一样”时优先保持一致性，降低自由发挥。未请求加字就不要新增文案。',
    `生成后若工具允许查看结果，应${identityPaths.length ? '对照 OC 身份图检查角色长相，对照用户原图检查姿态、构图和文字' : '对照原图检查身份、姿态、构图、配色和文字'}；明显偏离则针对差异修正，不能声称完全一致。不得把原参考图或已有表情包冒充新生成图。`,
    '参考图路径仅供工具调用，不在 QQ 回复中公开。'
  ].join('\n');
}

export async function prepareGenerationReferences({ event, text, referenceDir, prepareImages, roleIdentity=null }) {
  const inputs = collectGenerationReferences(event);
  const identitySelection=resolveGenerationIdentity(text);
  const useOc = identitySelection.useOc || Boolean(roleIdentity && /狐[宫宮][静靜]\s*(?:和|與|与|跟|、)|(?:和|與|与|跟|、)\s*狐[宫宮][静靜]/.test(text));
  // Retrying a new drawing does not imply editing a missing source image.
  const correctionOnly = /^(?:重新画|重新生成|重新绘制)[呀吧啦呜～~！!。\s]*$/.test(text.trim())
    || /(?:字|动作|姿势|手指|衣服|尾巴).{0,8}(?:错|不对|异常).{0,12}(?:重|修|改)/.test(text);
  const explicitReference = correctionOnly || /参考图|原图|照(?:着)?这(?:张|个)|按这(?:张|个)|模仿这(?:张|个)|仿照|复刻/.test(text) || ((useOc||roleIdentity) && /这(?:个|张)(?:图|表情包)/.test(text));
  if (!inputs.length && explicitReference) return { error: '我还没收到这次要参考的原图呜，请把图片和生图要求一起发来，或回复那张图再告诉我要改哪里～', inputs, imagePaths: [] };
  if (inputs.length > 3) return { error: '这次参考图超过 3 张啦，请选出最重要的 1～3 张并说明各自用途，我再按原图来画～', inputs, imagePaths: [] };
  const imagePaths = inputs.length ? await prepareImages(inputs) : [];
  if (imagePaths.length !== inputs.length) {
    const errors=(event.imagePreparationErrors||[]).join(' ');
    const reason=/exceeds 20|超过 20/.test(errors)?'有参考图实际超过 20 MB，请压缩后重发。':/host is not permitted|Private image destination/.test(errors)?'图片地址未通过安全校验，请重发原图。':/timed out|timeout/i.test(errors)?'下载参考图超时，请稍后重新引用原图重试。':/HTTP (403|404)|No downloadable/.test(errors)?'引用图链接失效或暂不可用，请重发原图。':'请重新引用原图重试；读取失败不代表图片超过大小限制。';
    return {error:'参考图没有全部读取成功，暂未开始生图。'+reason,inputs,imagePaths};
  }
  const character = (!useOc && roleIdentity) || await loadQqCharacter(referenceDir, {
    attachImages: useOc, userReference: inputs.length > 0, generationRequest: true,
    useOc, userImageCount: imagePaths.length,
    summer: /草帽|墨镜|夏日|沙滩/.test(text)
  });
  if(useOc&&!character.imagePaths.length)throw new Error('已指定狐宫静 OC，但角色参考图未加载，已停止请求，避免凭名字猜画');
  if (useOc && roleIdentity) {
    const identities = [
      {name:'狐宫静', imagePaths:character.imagePaths, appearance:character.appearance},
      {name:roleIdentity.name, imagePaths:roleIdentity.imagePaths, appearance:roleIdentity.appearance}
    ];
    const identityPaths = identities.flatMap(role=>role.imagePaths);
    let index = imagePaths.length;
    const prompt = [
      '本次是双人同框。分别保留两人的身份，不能混用外貌、服装或饰品。明确指定位置时按用户要求，否则按原图从左到右、角色按请求中的顺序安排。',
      ...identities.map(role=>JSON.stringify({name:role.name,appearance:role.appearance,referenceNumbers:role.imagePaths.map(()=>++index)})),
      ...imagePaths.map((path,i)=>`图 ${i+1} 是构图模板，保留画面、姿态、背景和原有文字：${JSON.stringify(path)}`),
      `实际调用 image_gen 时传入 referenced_image_paths: ${JSON.stringify([...imagePaths,...identityPaths])}`
    ].join('\n');
    return {inputs,imagePaths,character:{imagePaths:identityPaths,prompt,identities},mode:'multi-character',identitySelection:{useOc:true,roleId:roleIdentity.id,name:'狐宫静、'+roleIdentity.name},prompt};
  }
  return { inputs, imagePaths, character, identitySelection:roleIdentity?{useOc:false,roleId:roleIdentity.id,name:roleIdentity.name,reason:'registered-role'}:identitySelection,mode: roleIdentity?'registered-role':inputs.length ? (useOc ? 'hugongjing-oc-reference' : 'user-reference-strict') : (useOc ? 'hugongjing-oc' : 'requested-subject'), prompt: buildStrictReferencePrompt(imagePaths, inputs, useOc||roleIdentity ? character.imagePaths : [],roleIdentity?.name||'狐宫静') };
}
