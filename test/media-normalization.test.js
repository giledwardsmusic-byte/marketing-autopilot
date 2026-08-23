import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_IMAGE_PROFILES, profileForPlatform, variantPath, validateOriginalForPlatform } from '../src/lib/media-normalization.js';

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

test('original fallback validation allows safe Facebook and Pinterest images',()=>{
  const jpeg={mime_type:'image/jpeg',size_bytes:500000,width:1200,height:1200};
  const png={mime_type:'image/png',size_bytes:700000,width:1000,height:1500};
  assert.equal(validateOriginalForPlatform('facebook',jpeg).ok,true);
  assert.equal(validateOriginalForPlatform('pinterest',png).ok,true);
});

test('Instagram fallback requires JPEG and accepted feed aspect ratio',()=>{
  assert.equal(validateOriginalForPlatform('instagram',{mime_type:'image/jpeg',size_bytes:500000,width:1080,height:1350}).ok,true);
  assert.equal(validateOriginalForPlatform('instagram',{mime_type:'image/png',size_bytes:500000,width:1080,height:1350}).ok,false);
  assert.equal(validateOriginalForPlatform('instagram',{mime_type:'image/jpeg',size_bytes:500000,width:600,height:1200}).ok,false);
});

test('fallback fails closed for unknown dimensions, oversized files and TikTok static images',()=>{
  assert.equal(validateOriginalForPlatform('facebook',{mime_type:'image/jpeg',size_bytes:1000,width:null,height:null}).ok,false);
  assert.equal(validateOriginalForPlatform('pinterest',{mime_type:'image/jpeg',size_bytes:21*1024*1024,width:1000,height:1500}).ok,false);
  assert.equal(validateOriginalForPlatform('tiktok',{mime_type:'image/jpeg',size_bytes:1000,width:1080,height:1920}).ok,false);
});
