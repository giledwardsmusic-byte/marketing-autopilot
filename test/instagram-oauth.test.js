import test from 'node:test';
import assert from 'node:assert/strict';
import {
  instagramAuthorizationUrl,
  instagramRedirectUri,
  exchangeInstagramCode,
  exchangeLongLivedInstagramToken,
  fetchInstagramIdentity,
  assertExpectedInstagramUsername
} from '../src/lib/instagram-oauth.js';

function jsonResponse(data,status=200){
  return {ok:status>=200&&status<300,status,async json(){return data;}};
}

test('builds Instagram Business Login URL with direct-login scopes',()=>{
  const redirectUri=instagramRedirectUri('https://example.test');
  const url=new URL(instagramAuthorizationUrl({appId:'123',redirectUri,state:'state-1'}));
  assert.equal(url.origin,'https://www.instagram.com');
  assert.equal(url.pathname,'/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'),'123');
  assert.equal(url.searchParams.get('redirect_uri'),'https://example.test/oauth/instagram/callback');
  assert.equal(url.searchParams.get('scope'),'instagram_business_basic,instagram_business_content_publish');
  assert.equal(url.searchParams.get('state'),'state-1');
  assert.equal(url.searchParams.get('force_reauth'),'true');
});

test('exchanges authorization code at api.instagram.com',async()=>{
  let seen;
  const fetchFn=async(url,options)=>{seen={url,options};return jsonResponse({access_token:'short-token',user_id:'ig-1'});};
  const data=await exchangeInstagramCode({appId:'123',appSecret:'secret',redirectUri:'https://example.test/oauth/instagram/callback',code:'abc',fetchFn});
  assert.equal(data.access_token,'short-token');
  assert.equal(seen.url,'https://api.instagram.com/oauth/access_token');
  assert.equal(seen.options.method,'POST');
  assert.equal(seen.options.body.get('grant_type'),'authorization_code');
  assert.equal(seen.options.body.get('client_id'),'123');
});

test('exchanges short token for long-lived token on graph.instagram.com',async()=>{
  let seenUrl='';
  const fetchFn=async url=>{seenUrl=String(url);return jsonResponse({access_token:'long-token',expires_in:5184000});};
  const data=await exchangeLongLivedInstagramToken({shortToken:'short-token',appSecret:'secret',fetchFn});
  assert.equal(data.access_token,'long-token');
  const url=new URL(seenUrl);
  assert.equal(url.origin,'https://graph.instagram.com');
  assert.equal(url.pathname,'/access_token');
  assert.equal(url.searchParams.get('grant_type'),'ig_exchange_token');
});

test('reads Instagram identity from graph.instagram.com',async()=>{
  let seenUrl='';
  const fetchFn=async url=>{seenUrl=String(url);return jsonResponse({id:'178414000',username:'tablerockpress'});};
  const identity=await fetchInstagramIdentity({token:'long-token',fetchFn});
  assert.deepEqual(identity,{id:'178414000',username:'tablerockpress'});
  assert.match(seenUrl,/^https:\/\/graph\.instagram\.com\/v25\.0\/me\?/);
});

test('rejects authorization of the wrong Instagram account',()=>{
  assert.equal(assertExpectedInstagramUsername('@tablerockpress'),true);
  assert.throws(()=>assertExpectedInstagramUsername('giledwardsrocks_'),/Wrong Instagram account authorized: @giledwardsrocks_/);
});
