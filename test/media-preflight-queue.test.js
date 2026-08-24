import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightDueMedia } from '../src/entry.js';

function envForMediaRetry(){
  const state={post:{id:'post1',platform:'instagram',status:'scheduled',error_message:null,public_token:'tok'},asset:{r2_key:'assets/a',mime_type:'image/png',size_bytes:500000,width:1080,height:1350,status:'approved'},health:[]};
  const DB={
    prepare(sql){
      return {
        args:[],
        bind(...args){this.args=args;return this;},
        async all(){
          if(sql.includes('FROM scheduled_posts sp JOIN assets a')){
            const retry=state.post.status==='paused'&&String(state.post.error_message||'').startsWith('MEDIA_BLOCKED_RETRY:');
            const due=['scheduled','approved'].includes(state.post.status)||retry;
            return {results:due?[{...state.post}]:[]};
          }
          throw new Error(`Unexpected all SQL: ${sql}`);
        },
        async first(){
          if(sql.includes('FROM assets WHERE public_token='))return state.asset;
          if(sql.includes('SELECT id FROM health_events'))return null;
          throw new Error(`Unexpected first SQL: ${sql}`);
        },
        async run(){
          if(sql.includes("UPDATE scheduled_posts SET status='paused'")){
            state.post.status='paused';state.post.error_message=this.args[0];return {meta:{changes:1}};
          }
          if(sql.includes("UPDATE scheduled_posts SET status='scheduled'")){
            state.post.status='scheduled';state.post.error_message=null;return {meta:{changes:1}};
          }
          if(sql.includes('INSERT INTO health_events')){
            state.health.push({component:this.args[1],severity:this.args[2],message:this.args[3]});return {meta:{changes:1}};
          }
          if(sql.includes('UPDATE health_events SET resolved=1'))return {meta:{changes:1}};
          throw new Error(`Unexpected run SQL: ${sql}`);
        }
      };
    }
  };
  return {
    state,DB,
    MEDIA:{async get(){return {body:new Uint8Array([1,2,3])};}},
    IMAGES:{input(){return {transform(){return this;},output(){return {async response(){return new Response('Cloudflare Images error 9422',{status:429});}};}};}}
  };
}

test('unsafe original is paused before platform publishing and retained for retry',async()=>{
  const env=envForMediaRetry();
  const result=await preflightDueMedia(env);
  assert.deepEqual(result,{checked:1,paused:1,requeued:0});
  assert.equal(env.state.post.status,'paused');
  assert.match(env.state.post.error_message,/^MEDIA_BLOCKED_RETRY:/);
  assert.ok(env.state.health.some(x=>x.component==='media:post:post1'&&x.severity==='red'));
});

test('paused media post automatically returns to the queue when fallback becomes safe',async()=>{
  const env=envForMediaRetry();
  await preflightDueMedia(env);
  assert.equal(env.state.post.status,'paused');
  env.state.asset.mime_type='image/jpeg';
  const result=await preflightDueMedia(env);
  assert.deepEqual(result,{checked:1,paused:0,requeued:1});
  assert.equal(env.state.post.status,'scheduled');
  assert.equal(env.state.post.error_message,null);
});
