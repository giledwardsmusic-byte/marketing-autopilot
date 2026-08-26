import test from 'node:test';
import assert from 'node:assert/strict';
import { serveImageVariant } from '../src/lib/media-normalization.js';

function missingSourceEnv(){
  const asset={r2_key:'assets/missing.jpg',mime_type:'image/jpeg',size_bytes:500000,width:1080,height:1350,status:'approved',sha256:'missing-source-hash'};
  const healthRows=[];
  return {
    healthRows,
    DB:{
      prepare(sql){
        return {
          args:[],
          bind(...args){this.args=args;return this;},
          async first(){
            if(sql.includes('FROM assets WHERE public_token='))return asset;
            if(sql.includes('SELECT id FROM health_events'))return null;
            throw new Error(`Unexpected first SQL: ${sql}`);
          },
          async run(){
            if(sql.includes('INSERT INTO health_events')){
              healthRows.push({component:this.args[1],severity:this.args[2],message:this.args[3]});
              return {meta:{changes:1}};
            }
            throw new Error(`Unexpected run SQL: ${sql}`);
          }
        };
      }
    },
    MEDIA:{async get(){return null;}},
    IMAGES:{input(){throw new Error('transform must never run when source is missing');}}
  };
}

test('missing approved source media fails closed before any platform can fetch it',async()=>{
  const env=missingSourceEnv();
  const response=await serveImageVariant(env,'instagram','tok');
  assert.equal(response.status,415);
  assert.equal(response.headers.get('x-ma-media-state'),'blocked');
  assert.equal(response.headers.get('x-ma-fallback-reason'),'source asset unavailable');
  assert.match(await response.text(),/source asset is missing from storage/i);
  assert.ok(env.healthRows.some(x=>x.component==='media:instagram:tok'&&x.severity==='red'));
});
