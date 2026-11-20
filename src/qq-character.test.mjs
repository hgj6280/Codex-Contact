import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadQqCharacter } from './qq-character.mjs';
import { isImageGenerationRequest } from './qq-codex-images.mjs';
import { imageSegment } from './qq-media.mjs';

const referenceDir = fileURLToPath(new URL('../assets/qq-character/hugongjing/', import.meta.url));

test('new sticker requests load only the default reference unless seasonal accessories are requested', async () => {
  for (const text of ['生成一张委屈的表情包', '狐宫静做表情包', '把你画成表情包', '画一张你的头像']) {
    assert.equal(isImageGenerationRequest(text), true, text);
  }
  const character = await loadQqCharacter(referenceDir, { attachImages: true });
  assert.equal(character.imagePaths.length, 1);
  assert.ok(character.imagePaths[0].endsWith('reference-default.png'));
  for (const path of character.imagePaths) assert.equal((await imageSegment(path, [referenceDir])).type, 'image');
  assert.match(character.prompt, /第 1 张是固定基础形象/);
  assert.match(character.prompt, /不附加夏日配饰图/);
  assert.match(character.prompt, /红色/);
  const seasonal = await loadQqCharacter(referenceDir, { attachImages: true, summer: true });
  assert.equal(seasonal.imagePaths.length, 2);
  assert.ok(seasonal.imagePaths[1].endsWith('reference-summer.png'));
});

test('normal chat and sending existing stickers do not attach extra image inputs', async () => {
  assert.equal(isImageGenerationRequest('狐宫静你好'), false);
  assert.equal(isImageGenerationRequest('发一个表情包'), false);
  const character = await loadQqCharacter(referenceDir);
  assert.deepEqual(character.imagePaths, []);
  assert.match(character.prompt, /先用 view_image/);
  assert.match(character.prompt, /明确指定其他角色或物体时遵循对方要求/);
});
