import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_IMAGE_PROFILES, profileForPlatform, variantPath } from '../src/lib/media-normalization.js';

test('platform profiles use intended aspect ratios and dimensions',()=>{
  assert.deepEqual([PLATFORM_IMAGE_PROFILES.pinterest.width,PLATFORM_IMAGE_PROFILES.pinterest.height],[1000,1500]);
  assert.equal(PLATFORM_IMAGE_PROFILES.pinterest.ratio,'2:3');
  assert.deepEqual([PLATFORM_IMAGE_PROFILES.instagram.width,PLATFORM_IMAGE_PROFILES.instagram.height],[1080,1350]);
  assert.equal(PLATFORM_IMAGE_PROFILES.instagram.ratio,'4:5');
  assert.equal(PLATFORM_IMAGE_PROFILES.facebook.fit,'contain');
  assert.deepEqual([PLATFORM_IMAGE_PROFILES.tiktok.width,PLATFORM_IMAGE_PROFILES.tiktok.height],[1080,1920]);
  assert.equal(PLATFORM_IMAGE_PROFILES.tiktok.ratio,'9:16');
});

test('variant path is deterministic and platform-specific',()=>{
  assert.equal(variantPath('Pinterest','abc 123'),'/media-variant/pinterest/abc%20123');
  assert.equal(variantPath('instagram','tok'),'/media-variant/instagram/tok');
});

test('unsupported platforms fail closed',()=>{
  assert.throws(()=>profileForPlatform('unknown'),/Unsupported media platform/);
  assert.throws(()=>variantPath('unknown','x'),/Unsupported media platform/);
});
