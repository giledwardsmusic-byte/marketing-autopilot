import test from 'node:test';
import assert from 'node:assert/strict';
import { queryTikTokCreator, tiktokDirectVideo, fetchTikTokPostStatus } from '../src/lib/tiktok-direct.js';

function fakeFetch(queue,calls){return async (url,opts)=>{calls.push({url,opts,body:opts?.body?JSON.parse(opts.body):null});const next=queue.shift();return {ok:next.ok??true,status:next.status??200,json:async()=>next.body};};}

const creator={data:{creator_username:'tablerockpress',privacy_level_options:['SELF_ONLY','PUBLIC_TO_EVERYONE'],comment_disabled:false,duet_disabled:false,stitch_disabled:false},error:{code:'ok',message:''}};

test('queries creator info before any direct post',async()=>{const calls=[];const f=fakeFetch([{body:creator}],calls);const c=await queryTikTokCreator('tok',f);assert.equal(c.creator_username,'tablerockpress');assert.match(calls[0].url,/creator_info\/query/);});

test('direct video defaults to SELF_ONLY and uses PULL_FROM_URL',async()=>{const calls=[];const f=fakeFetch([{body:creator},{body:{data:{publish_id:'v_pub_url~123'},error:{code:'ok',message:''}}}],calls);const out=await tiktokDirectVideo({token:'tok',caption:'Buddy in the Whispering Forest',videoUrl:'https://example.com/buddy.mp4'},f);assert.equal(out.externalId,'v_pub_url~123');assert.equal(out.state,'submitted');assert.equal(calls[1].body.post_info.privacy_level,'SELF_ONLY');assert.equal(calls[1].body.post_info.brand_organic_toggle,true);assert.equal(calls[1].body.source_info.source,'PULL_FROM_URL');});

test('rejects a privacy level not offered by creator',async()=>{const calls=[];const f=fakeFetch([{body:creator}],calls);await assert.rejects(()=>tiktokDirectVideo({token:'tok',videoUrl:'https://example.com/buddy.mp4',privacyLevel:'MUTUAL_FOLLOW_FRIENDS'},f),/not allowed/);assert.equal(calls.length,1);});

test('fetches publish status by publish id',async()=>{const calls=[];const f=fakeFetch([{body:{data:{status:'PROCESSING_DOWNLOAD'},error:{code:'ok',message:''}}}],calls);const out=await fetchTikTokPostStatus('tok','v_pub_url~123',f);assert.equal(out.status,'PROCESSING_DOWNLOAD');assert.match(calls[0].url,/status\/fetch/);});
