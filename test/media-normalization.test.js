import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_IMAGE_PROFILES, profileForPlatform, variantPath, variantStorageKey, validateOriginalForPlatform, serveImageVariant } from '../src/lib/media-normalization.js';

test('platform profiles use intended aspect ratios and dimensions',()=>{
  assert.deepEqual([PLATFORM_IMAGE_PROFILES.pinterest.width,PLATFORM_IMAGE_PROFILES.pinterest.height],[1000,1500]);
  assert.equal(PLATFORM_IMAGE_PROFILES.pinterest.ratio,'2:3');
  assert.deepEqual([PLATFORM_IMAGE_PROFILES.instagram.width,PLATFORM_IMAGE_PROFILES.instagram.height],[1080,1350]);
  assert.equal(PLATFORM_IMAGE_PROFILES.instagram.ratio,'4:5');
  assert.equal(PLATFORM_IMAGE_PROFILES.facebook.fit,'contain');
  assert.deepEqual([PLATFORM_IMAGE_PROFILES.tiktok.width,PLATFORM_IMAGE_PROFILES.tiktok.height],[1080,1920]);
  assert.equal(PLATFORM_IMAGE_PROFILES.tiktok.ratio,'9:16');
});

test('variant path and storage key are deterministic and source-hash-specific',()=>{
  assert.equal(variantPath('Pinterest','abc 123'),'/media-variant/pinterest/abc%20123');
  assert.equal(variantPath('instagram','tok'),'/media-variant/instagram/tok');
  assert.equal(variantStorageKey('instagram','tok','abc123'),'derived/instagram/tok-abc123.jpg');
  assert.notEqual(variantStorageKey('instagram','tok','abc123'),variantStorageKey('instagram','tok','def456'));
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

test('TikTok photo fallback accepts JPEG/WebP at 1080p and rejects PNG/oversize',()=>{
  assert.equal(validateOriginalForPlatform('tiktok',{mime_type:'image/jpeg',size_bytes:1000,width:1080,height:1920}).ok,true);
  assert.equal(validateOriginalForPlatform('tiktok',{mime_type:'image/webp',size_bytes:1000,width:1080,height:1920}).ok,true);
  assert.equal(validateOriginalForPlatform('tiktok',{mime_type:'image/png',size_bytes:1000,width:1080,height:1920}).ok,false);
  assert.equal(validateOriginalForPlatform('tiktok',{mime_type:'image/jpeg',size_bytes:1000,width:1440,height:2560}).ok,false);
});

test('fallback fails closed for unknown dimensions and oversized files',()=>{
  assert.equal(validateOriginalForPlatform('facebook',{mime_type:'image/jpeg',size_bytes:1000,width:null,height:null}).ok,false);
  assert.equal(validateOriginalForPlatform('pinterest',{mime_type:'image/jpeg',size_bytes:21*1024*1024,width:1000,height:1500}).ok,false);
});

function quotaEnv(asset,{missingOnReopen=false}={}){
  const healthEvents=[];
  let mediaGets=0;
  return {
    healthEvents,
    get mediaGets(){return mediaGets;},
    DB:{
      prepare(sql){
        return {
          args:[],
          bind(...args){this.args=args;return this;},
          async first(){
            if(sql.includes('FROM assets WHERE public_token=')) return asset;
            if(sql.includes('FROM health_events')) return null;
            if(sql.includes('SELECT value_json FROM settings')) return null;
            throw new Error(`Unexpected first SQL: ${sql}`);
          },
          async run(){
            if(sql.includes('INSERT INTO health_events')){healthEvents.push({component:this.args[1],severity:this.args[2],message:this.args[3]});return {meta:{changes:1}};}
            if(sql.includes('INSERT INTO settings')) return {meta:{changes:1}};
            throw new Error(`Unexpected run SQL: ${sql}`);
          }
        };
      }
    },
    MEDIA:{
      async get(key){
        if(String(key).startsWith('derived/'))return null;
        mediaGets++;
        if(missingOnReopen&&mediaGets>1)return null;
        return {body:new Uint8Array([mediaGets,2,3])};
      },
      async put(){}
    },
    IMAGES:{
      input(){return {
        transform(){return this;},
        output(){return {async response(){return new Response('Cloudflare Images error 9422',{status:429});}};}
      };}
    }
  };
}

test('Cloudflare quota error 9422 reopens and serves a fresh valid original',async()=>{
  const env=quotaEnv({r2_key:'assets/a.jpg',mime_type:'image/jpeg',size_bytes:500000,width:1080,height:1350,status:'approved',sha256:'hash-a'});
  const response=await serveImageVariant(env,'instagram','tok');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-ma-media-state'),'original-fallback');
  assert.equal(response.headers.get('content-type'),'image/jpeg');
  assert.equal(env.mediaGets,2,'fallback must reopen R2 after a transform attempt');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[2,2,3]);
  assert.equal(env.healthEvents.length,1);
  assert.equal(env.healthEvents[0].severity,'yellow');
  assert.match(env.healthEvents[0].message,/quota exhausted/i);
  assert.match(env.healthEvents[0].message,/original asset passed/i);
});

test('Cloudflare quota error fails closed when original is invalid for destination',async()=>{
  const env=quotaEnv({r2_key:'assets/a.png',mime_type:'image/png',size_bytes:500000,width:1080,height:1350,status:'approved',sha256:'hash-b'});
  const response=await serveImageVariant(env,'instagram','tok');
  assert.equal(response.status,415);
  assert.equal(response.headers.get('x-ma-media-state'),'blocked');
  assert.equal(env.mediaGets,1,'invalid originals must not be reopened or served');
  assert.equal(env.healthEvents.length,1);
  assert.equal(env.healthEvents[0].severity,'red');
  assert.match(env.healthEvents[0].message,/paused instead of sending broken media/i);
});

test('fallback fails closed if the original disappears before it can be reopened',async()=>{
  const env=quotaEnv({r2_key:'assets/a.jpg',mime_type:'image/jpeg',size_bytes:500000,width:1080,height:1350,status:'approved',sha256:'hash-c'},{missingOnReopen:true});
  const response=await serveImageVariant(env,'instagram','tok');
  assert.equal(response.status,503);
  assert.equal(response.headers.get('x-ma-media-state'),'blocked');
  assert.equal(env.mediaGets,2);
  assert.equal(env.healthEvents.length,1);
  assert.equal(env.healthEvents[0].severity,'red');
  assert.match(env.healthEvents[0].message,/could not be reopened/i);
});
