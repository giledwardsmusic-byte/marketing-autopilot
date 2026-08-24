import test from 'node:test';
import assert from 'node:assert/strict';
import { serveImageVariant } from '../src/lib/media-normalization.js';

function envFor(platformAsset={r2_key:'assets/a.jpg',mime_type:'image/jpeg',size_bytes:500000,width:1200,height:1200,status:'approved'}){
  const calls={transform:null,output:null};
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
    MEDIA:{async get(){return {body:new Uint8Array([1,2,3])};}},
    IMAGES:{
      input(){return {
        transform(opts){calls.transform=opts;return this;},
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
  test(`${platform} normalized output uses the platform profile and advertises normalized state`,async()=>{
    const env=envFor();
    const response=await serveImageVariant(env,platform,'tok');
    assert.equal(response.status,200);
    assert.deepEqual(env.calls.transform,transform);
    assert.equal(env.calls.output.format,'image/jpeg');
    assert.ok(env.calls.output.quality>=80);
    assert.equal(response.headers.get('x-ma-media-state'),'normalized');
    assert.equal(response.headers.get('x-ma-platform'),platform);
    assert.equal(response.headers.get('x-ma-ratio'),ratio);
    assert.equal(response.headers.get('content-type'),'image/jpeg');
  });
}
