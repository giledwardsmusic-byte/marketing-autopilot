import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_SCOPES,
  tiktokAuthorizationUrl,
  tiktokRedirectUri,
  exchangeTikTokCode,
  refreshTikTokToken,
  parseTikTokSecret,
  tiktokTokenNeedsRefresh
} from '../src/lib/tiktok-oauth.js';

test('TikTok authorization URL requests publishing scopes and preserves state',()=>{
  const redirect='https://example.com/oauth/tiktok/callback';
  const url=new URL(tiktokAuthorizationUrl({clientKey:'client-key',redirectUri:redirect,state:'csrf-123'}));
  assert.equal(url.origin,'https://www.tiktok.com');
  assert.equal(url.pathname,'/v2/auth/authorize/');
  assert.equal(url.searchParams.get('client_key'),'client-key');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('redirect_uri'),redirect);
  assert.equal(url.searchParams.get('state'),'csrf-123');
  assert.deepEqual(url.searchParams.get('scope').split(','),TIKTOK_SCOPES);
});

test('TikTok redirect URI defaults to app callback and requires HTTPS when authorizing',()=>{
  assert.equal(tiktokRedirectUri({},'https://app.example.com/'),'https://app.example.com/oauth/tiktok/callback');
  assert.throws(()=>tiktokAuthorizationUrl({clientKey:'x',redirectUri:'http://example.com/callback',state:'s'}),/HTTPS/);
});

test('TikTok code exchange stores refreshable token metadata',async()=>{
  const now=Date.UTC(2026,7,25,10,0,0);
  let captured;
  const fetchFn=async(url,options)=>{
    captured={url,options,body:Object.fromEntries(new URLSearchParams(options.body))};
    return new Response(JSON.stringify({access_token:'access',refresh_token:'refresh',expires_in:86400,refresh_expires_in:31536000,open_id:'open-1',scope:'user.info.basic,video.publish',token_type:'Bearer'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const bundle=await exchangeTikTokCode({clientKey:'key',clientSecret:'secret',code:'code-1',redirectUri:'https://app.example.com/oauth/tiktok/callback',fetchFn,nowMs:now});
  assert.equal(captured.url,'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(captured.body.client_key,'key');
  assert.equal(captured.body.client_secret,'secret');
  assert.equal(captured.body.grant_type,'authorization_code');
  assert.equal(captured.body.code,'code-1');
  assert.equal(bundle.access_token,'access');
  assert.equal(bundle.refresh_token,'refresh');
  assert.equal(bundle.open_id,'open-1');
  assert.equal(bundle.access_expires_at,new Date(now+86400_000).toISOString());
  assert.equal(bundle.refresh_expires_at,new Date(now+31536000_000).toISOString());
});

test('TikTok refresh preserves prior refresh token if response rotates only access token',async()=>{
  const previous={access_token:'old',refresh_token:'keep-me',open_id:'open-1',scope:'video.publish',access_expires_at:'2026-08-25T10:00:00.000Z',refresh_expires_at:'2027-08-25T10:00:00.000Z'};
  const fetchFn=async(_url,options)=>{
    const body=Object.fromEntries(new URLSearchParams(options.body));
    assert.equal(body.grant_type,'refresh_token');
    assert.equal(body.refresh_token,'keep-me');
    return new Response(JSON.stringify({access_token:'new',expires_in:86400}),{status:200,headers:{'content-type':'application/json'}});
  };
  const bundle=await refreshTikTokToken({clientKey:'key',clientSecret:'secret',bundle:previous,fetchFn,nowMs:Date.UTC(2026,7,25)});
  assert.equal(bundle.access_token,'new');
  assert.equal(bundle.refresh_token,'keep-me');
  assert.equal(bundle.open_id,'open-1');
});

test('TikTok secret parser supports legacy token and JSON bundle',()=>{
  assert.equal(parseTikTokSecret('plain-token').access_token,'plain-token');
  assert.equal(parseTikTokSecret('{"access_token":"a","refresh_token":"r"}').refresh_token,'r');
  assert.throws(()=>parseTikTokSecret('{"refresh_token":"r"}'),/missing access_token/);
});

test('TikTok refresh threshold catches expiring access token',()=>{
  const now=Date.UTC(2026,7,25,10,0,0);
  assert.equal(tiktokTokenNeedsRefresh({access_expires_at:new Date(now+30*60*1000).toISOString()},now),true);
  assert.equal(tiktokTokenNeedsRefresh({access_expires_at:new Date(now+2*60*60*1000).toISOString()},now),false);
});
