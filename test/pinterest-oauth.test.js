import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PINTEREST_SCOPES,
  pinterestAuthorizationUrl,
  pinterestTokenBundle,
  exchangePinterestCode,
  refreshPinterestToken,
  parsePinterestSecret,
  pinterestTokenNeedsRefresh
} from '../src/lib/pinterest-oauth.js';

test('authorization URL requests only board and pin scopes and preserves state',()=>{
  const url=new URL(pinterestAuthorizationUrl({clientId:'123',redirectUri:'https://example.com/oauth/pinterest/callback',state:'abc'}));
  assert.equal(url.origin,'https://www.pinterest.com');
  assert.equal(url.searchParams.get('client_id'),'123');
  assert.equal(url.searchParams.get('state'),'abc');
  assert.equal(url.searchParams.get('scope'),PINTEREST_SCOPES.join(','));
  assert.equal(url.searchParams.get('response_type'),'code');
});

test('token bundle records rotating access and refresh expirations',()=>{
  const now=Date.UTC(2026,7,24,12,0,0);
  const bundle=pinterestTokenBundle({access_token:'pina_access',refresh_token:'pinr_refresh',expires_in:2592000,refresh_token_expires_in:5184000,scope:'pins:write'},now);
  assert.equal(bundle.access_token,'pina_access');
  assert.equal(bundle.refresh_token,'pinr_refresh');
  assert.equal(bundle.access_expires_at,'2026-09-23T12:00:00.000Z');
  assert.equal(bundle.refresh_expires_at,'2026-10-23T12:00:00.000Z');
});

test('authorization code exchange uses Basic auth and form encoding',async()=>{
  let seen;
  const fetchFn=async(url,init)=>{seen={url,init};return new Response(JSON.stringify({access_token:'pina_a',refresh_token:'pinr_r',expires_in:2592000,refresh_token_expires_in:5184000,scope:'boards:read,pins:write'}),{status:200,headers:{'content-type':'application/json'}});};
  const bundle=await exchangePinterestCode({clientId:'client',clientSecret:'secret',code:'code1',redirectUri:'https://example.com/oauth/pinterest/callback',fetchFn,nowMs:0});
  assert.equal(seen.url,'https://api.pinterest.com/v5/oauth/token');
  assert.match(seen.init.headers.authorization,/^Basic /);
  assert.match(String(seen.init.body),/grant_type=authorization_code/);
  assert.match(String(seen.init.body),/code=code1/);
  assert.equal(bundle.access_token,'pina_a');
});

test('refresh rotates refresh token and keeps prior one if provider omits replacement',async()=>{
  const old={access_token:'old',refresh_token:'pinr_keep',scope:'pins:write',access_expires_at:'2026-08-25T00:00:00.000Z'};
  const fetchFn=async()=>new Response(JSON.stringify({access_token:'new',expires_in:2592000,scope:'pins:write'}),{status:200,headers:{'content-type':'application/json'}});
  const next=await refreshPinterestToken({clientId:'client',clientSecret:'secret',bundle:old,fetchFn,nowMs:0});
  assert.equal(next.access_token,'new');
  assert.equal(next.refresh_token,'pinr_keep');
});

test('legacy plain access tokens remain accepted while JSON bundles enable refresh',()=>{
  assert.equal(parsePinterestSecret('pina_legacy').access_token,'pina_legacy');
  assert.equal(parsePinterestSecret('{"access_token":"pina_new","refresh_token":"pinr_new"}').refresh_token,'pinr_new');
});

test('refresh threshold is seven days by default',()=>{
  const now=Date.UTC(2026,7,24,12,0,0);
  assert.equal(pinterestTokenNeedsRefresh({access_expires_at:'2026-08-30T12:00:00.000Z'},now),true);
  assert.equal(pinterestTokenNeedsRefresh({access_expires_at:'2026-09-05T12:00:00.000Z'},now),false);
});
