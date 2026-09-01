import { setting, setSetting } from './db.js';
import { encryptCredential } from './security.js';
import { nowIso } from './utils.js';

const AUTH_URL='https://www.instagram.com/oauth/authorize';
const TOKEN_URL='https://api.instagram.com/oauth/access_token';
const GRAPH_HOST='https://graph.instagram.com';
const GRAPH_VERSION='v25.0';
const EXPECTED_USERNAME='tablerockpress';
const OAUTH_TTL_MS=20*60*1000;

export function instagramRedirectUri(origin){
  return `${String(origin||'').replace(/\/$/,'')}/oauth/instagram/callback`;
}

export function instagramAuthorizationUrl({appId,redirectUri,state}){
  if(!appId)throw new Error('INSTAGRAM_APP_ID is required');
  if(!redirectUri)throw new Error('Instagram redirect URI is required');
  if(!state)throw new Error('Instagram OAuth state is required');
  const params=new URLSearchParams({
    client_id:String(appId),
    redirect_uri:String(redirectUri),
    response_type:'code',
    scope:'instagram_business_basic,instagram_business_content_publish',
    state:String(state),
    enable_fb_login:'0',
    force_authentication:'1'
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function readJson(response,label){
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error){
    const message=data?.error?.message||data?.error_description||data?.message||`HTTP ${response.status}`;
    throw new Error(`${label}: ${message}`);
  }
  return data;
}

export async function exchangeInstagramCode({appId,appSecret,redirectUri,code,fetchFn=fetch}){
  if(!appId||!appSecret)throw new Error('Instagram app credentials are missing');
  if(!code)throw new Error('Instagram authorization code is missing');
  const body=new FormData();
  body.set('client_id',String(appId));
  body.set('client_secret',String(appSecret));
  body.set('grant_type','authorization_code');
  body.set('redirect_uri',String(redirectUri));
  body.set('code',String(code));
  const response=await fetchFn(TOKEN_URL,{method:'POST',body});
  const data=await readJson(response,'Instagram token exchange');
  if(!data.access_token)throw new Error('Instagram returned no access token');
  return data;
}

export async function exchangeLongLivedInstagramToken({shortToken,appSecret,fetchFn=fetch}){
  if(!shortToken||!appSecret)throw new Error('Instagram token exchange inputs are missing');
  const params=new URLSearchParams({
    grant_type:'ig_exchange_token',
    client_secret:String(appSecret),
    access_token:String(shortToken)
  });
  const response=await fetchFn(`${GRAPH_HOST}/access_token?${params.toString()}`);
  const data=await readJson(response,'Instagram long-lived token exchange');
  if(!data.access_token)throw new Error('Instagram returned no long-lived access token');
  return data;
}

export async function fetchInstagramIdentity({token,fetchFn=fetch}){
  if(!token)throw new Error('Instagram access token is missing');
  const params=new URLSearchParams({fields:'id,username',access_token:String(token)});
  const response=await fetchFn(`${GRAPH_HOST}/${GRAPH_VERSION}/me?${params.toString()}`);
  const data=await readJson(response,'Instagram identity');
  if(!data.id||!data.username)throw new Error('Instagram did not return the account id and username');
  return {id:String(data.id),username:String(data.username)};
}

export function assertExpectedInstagramUsername(username){
  const actual=String(username||'').replace(/^@/,'').toLowerCase();
  if(actual!==EXPECTED_USERNAME){
    throw new Error(`Wrong Instagram account authorized: @${actual||'unknown'}. Marketing Autopilot requires @${EXPECTED_USERNAME}.`);
  }
  return true;
}

export async function beginInstagramOAuth(env,{origin,userId}){
  if(!env.INSTAGRAM_APP_ID||!env.INSTAGRAM_APP_SECRET){
    throw new Error('Direct Instagram authorization is not configured yet. INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET are required.');
  }
  const state=crypto.randomUUID();
  await setSetting(env,`oauth:instagram:${state}`,{created_at:nowIso(),user_id:userId||null});
  const redirectUri=instagramRedirectUri(origin);
  return {
    state,
    redirect_uri:redirectUri,
    authorization_url:instagramAuthorizationUrl({appId:env.INSTAGRAM_APP_ID,redirectUri,state})
  };
}

export async function completeInstagramOAuth(env,{origin,state,code,fetchFn=fetch}){
  if(!env.INSTAGRAM_APP_ID||!env.INSTAGRAM_APP_SECRET)throw new Error('Direct Instagram authorization is not configured.');
  if(!state||!code)throw new Error('Missing Instagram authorization response.');
  const marker=await setting(env,`oauth:instagram:${state}`,null);
  if(!marker)throw new Error('This Instagram authorization request expired or was already used.');
  const created=Date.parse(marker.created_at||'');
  if(!Number.isFinite(created)||Date.now()-created>OAUTH_TTL_MS){
    await setSetting(env,`oauth:instagram:${state}`,null);
    throw new Error('This Instagram authorization request expired. Start the connection again.');
  }
  await setSetting(env,`oauth:instagram:${state}`,null);

  const redirectUri=instagramRedirectUri(origin);
  const short=await exchangeInstagramCode({
    appId:env.INSTAGRAM_APP_ID,
    appSecret:env.INSTAGRAM_APP_SECRET,
    redirectUri,
    code,
    fetchFn
  });
  const long=await exchangeLongLivedInstagramToken({shortToken:short.access_token,appSecret:env.INSTAGRAM_APP_SECRET,fetchFn});
  const identity=await fetchInstagramIdentity({token:long.access_token,fetchFn});
  assertExpectedInstagramUsername(identity.username);

  const encrypted=await encryptCredential(env,String(long.access_token));
  const t=nowIso();
  const config=JSON.stringify({
    ig_user_id:identity.id,
    username:EXPECTED_USERNAME,
    api_version:GRAPH_VERSION,
    host:GRAPH_HOST,
    login_type:'instagram_business_login',
    token_expires_in:Number(long.expires_in||0)||undefined
  });

  await env.DB.prepare(`UPDATE connectors SET enabled=0,updated_at=? WHERE platform='instagram' AND connector_type='meta_instagram'`).bind(t).run();
  const existing=await env.DB.prepare(`SELECT id FROM connectors WHERE platform='instagram' AND connector_type='meta_instagram' AND json_extract(config_json,'$.username')=? ORDER BY priority ASC LIMIT 1`).bind(EXPECTED_USERNAME).first();
  let id;
  if(existing){
    id=existing.id;
    await env.DB.prepare(`UPDATE connectors SET name=?,enabled=1,priority=10,cost_cents_per_post=0,config_json=?,secret_ciphertext=?,secret_iv=?,last_error_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
      .bind(`Instagram @${EXPECTED_USERNAME}`,config,encrypted.ciphertext,encrypted.iv,t,id).run();
  }else{
    id=`con_${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,secret_ciphertext,secret_iv,created_at,updated_at) VALUES(?,?,'meta_instagram','instagram',1,10,0,?,?,?,?,?)`)
      .bind(id,`Instagram @${EXPECTED_USERNAME}`,config,encrypted.ciphertext,encrypted.iv,t,t).run();
  }
  return {id,ig_user_id:identity.id,username:EXPECTED_USERNAME,host:GRAPH_HOST};
}
