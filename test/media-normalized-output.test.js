import test from 'node:test';
import assert from 'node:assert/strict';
import { serveImageVariant } from '../src/lib/media-normalization.js';

function envFor(platformAsset={r2_key:'assets/a.jpg',mime_type:'image/jpeg',size_bytes:500000,width:1200,height:1200,status:'approved',sha256:'sourcehash'}){
  const calls={transform:null,output:null,transformCount:0,puts:[]};
  const stored=new Map();
  return {
    calls,
    DB:{
      prepare(sql){
        return {
          bind(){return this;},
          async first(){
            if(sql.includes('FROM assets WHERE public_token=')) return platformAsset;
            return null;
          }
        };
      }
    },
    MEDIA:{
      async get(key){
        if(stored.has(key))return {body:stored.get(key)};
        if(key===platformAsset.r2_key)return {body:new Uint8Array([1,2,3])};
        return null;
      },
      async put(key,body,options){
        const bytes=new Uint8Array(body);
        stored.set(key,bytes);
        calls.puts.push({key,bytes:[...bytes],options});
      }
    },
    IMAGES:{
      input(){return {
        transform(opts){calls.transform=opts;calls.transformCount++;return this;},
        output(opts){
          calls.output=opts;
          return {async response(){return new Response(new Uint8Array([9,8,7]),{status:200,headers:{'x-source':'mock'}});}};
        }
      };}
    }
  };
}

const cases=[
  ['pinterest',{width:1000,height:1500,fit:'cover'},'2:3'],
  ['instagram',{width:1080,height:1350,fit:'cover'},'4:5'],
  ['facebook',{width:1200,height:1500,fit:'contain'},'4:5'],
  ['tiktok',{width:1080,height:1920,fit:'cover'},'9:16']
];

for(const [platform,transform,ratio] of cases){
  test(`${platform} normalized output uses the platform profile and persists a reversible derivative`,async()=>{
    const env=envFor();
    const response=await serveImageVariant(env,platform,'tok');
    assert.equal(response.status,200);
    assert.deepEqual(env.calls.transform,transform);
    assert.equal(env.calls.output.format,'image/jpeg');
    assert.ok(env.calls.output.quality>=80);
    assert.equal(response.headers.get('x-ma-media-state'),'normalized');
    assert.equal(response.headers.get('x-ma-platform'),platform);
    assert.equal(response.headers.get('x-ma-ratio'),ratio);
    assert.equal(response.headers.get('x-ma-variant-cache'),'generated');
    assert.equal(response.headers.get('content-type'),'image/jpeg');
    assert.equal(env.calls.puts.length,1);
    assert.match(env.calls.puts[0].key,new RegExp(`^derived/${platform}/tok-sourcehash\\.jpg$`));
    assert.deepEqual(env.calls.puts[0].bytes,[9,8,7]);
    assert.equal(env.calls.puts[0].options.customMetadata.source_sha256,'sourcehash');

    const cached=await serveImageVariant(env,platform,'tok');
    assert.equal(cached.status,200);
    assert.equal(cached.headers.get('x-ma-variant-cache'),'hit');
    assert.deepEqual([...new Uint8Array(await cached.arrayBuffer())],[9,8,7]);
    assert.equal(env.calls.transformCount,1,'a cached derivative must not consume transformation quota again');
    assert.equal(env.calls.puts.length,1,'cache hits must not rewrite the derivative');
  });
}

test('cache write failure does not break a successfully normalized post',async()=>{
  const env=envFor();
  env.MEDIA.put=async()=>{throw new Error('R2 write failed');};
  const response=await serveImageVariant(env,'instagram','tok');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-ma-media-state'),'normalized');
  assert.equal(response.headers.get('x-ma-variant-cache'),'uncached');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[9,8,7]);
});
