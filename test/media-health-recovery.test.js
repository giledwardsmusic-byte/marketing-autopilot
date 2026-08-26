import test from 'node:test';
import assert from 'node:assert/strict';
import { serveImageVariant, variantStorageKey } from '../src/lib/media-normalization.js';

function recoveryEnv({cached=false}={}){
  const asset={r2_key:'assets/a.jpg',mime_type:'image/jpeg',size_bytes:500000,width:1080,height:1350,status:'approved',sha256:'hash-recovery'};
  const resolved=[];
  const cacheKey=variantStorageKey('instagram','tok',asset.sha256);
  return {
    resolved,
    DB:{
      prepare(sql){
        return {
          args:[],
          bind(...args){this.args=args;return this;},
          async first(){
            if(sql.includes('FROM assets WHERE public_token='))return asset;
            throw new Error(`Unexpected first SQL: ${sql}`);
          },
          async run(){
            if(sql.includes('UPDATE health_events SET resolved=1')){resolved.push(this.args[1]);return {meta:{changes:1}};}
            throw new Error(`Unexpected run SQL: ${sql}`);
          }
        };
      }
    },
    MEDIA:{
      async get(key){
        if(key===cacheKey)return cached?{body:new Uint8Array([9,9,9])}:null;
        if(key===asset.r2_key)return {body:new Uint8Array([1,2,3])};
        return null;
      },
      async put(){}
    },
    IMAGES:{
      input(){return {
        transform(){return this;},
        output(){return {async response(){return new Response(new Uint8Array([4,5,6]),{status:200,headers:{'content-type':'image/jpeg'}});}};}
      };}
    }
  };
}

test('successful regenerated media resolves prior per-asset Needs Attention event',async()=>{
  const env=recoveryEnv();
  const response=await serveImageVariant(env,'instagram','tok');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-ma-media-state'),'normalized');
  assert.deepEqual(env.resolved,['media:instagram:tok']);
});

test('cached normalized media also resolves prior per-asset Needs Attention event',async()=>{
  const env=recoveryEnv({cached:true});
  const response=await serveImageVariant(env,'instagram','tok');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-ma-variant-cache'),'hit');
  assert.deepEqual(env.resolved,['media:instagram:tok']);
});
