const TOKEN_URL='https://open.tiktokapis.com/v2/oauth/token/';
const AUTH_URL='https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_SCOPES=Object.freeze(['user.info.basic','video.publish']);

export function tiktokRedirectUri(env,origin){
  return env?.TIKTOK_REDIRECT_URI||`${String(origin||'').replace(/\/$/,'')}/oauth/tiktok/callback`;
}

export function tiktokAuthorizationUrl({clientKey,redirectUri,state,scopes=TIKTOK_SCOPES}){
  if(!clientKey)throw new Error('TikTok client key is required');
  if(!redirectUri||!/^https:\/\//i.test(redirectUri))throw new Error('TikTok redirect URI must be HTTPS');
  if(!state)throw new Error('TikTok OAuth state is required');
  const u=new URL(AUTH_URL);
  u.searchParams.set('client_key',clientKey);
  u.searchParams.set('response_type','code');
  u.searchParams.set('scope',scopes.join(','));
  u.searchParams.set('redirect_uri',redirectUri);
  u.searchParams.set('state',state);
  return u.toString();
}

async function tokenRequest({clientKey,clientSecret,body,fetchFn=fetch}){
  if(!clientKey||!clientSecret)throw new Error('TikTok client key and secret are required');
  const r=await fetchFn(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_key:clientKey,client_secret:clientSecret,...body})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.access_token)throw new Error(`TikTok OAuth ${r.status}: ${data?.error_description||data?.error||'token request failed'}`);
  return data;
}

export function tiktokTokenBundle(data,nowMs=Date.now(),previous={}){
  if(!data?.access_token)throw new Error('TikTok returned no access token');
  const accessSeconds=Math.max(0,Number(data.expires_in||0));
  const refreshSeconds=Math.max(0,Number(data.refresh_expires_in||0));
  return {
    access_token:String(data.access_token),
    refresh_token:String(data.refresh_token||previous.refresh_token||''),
    open_id:String(data.open_id||previous.open_id||''),
    scope:String(data.scope||previous.scope||''),
    token_type:String(data.token_type||'Bearer'),
    access_expires_at:accessSeconds?new Date(nowMs+accessSeconds*1000).toISOString():(previous.access_expires_at||null),
    refresh_expires_at:refreshSeconds?new Date(nowMs+refreshSeconds*1000).toISOString():(previous.refresh_expires_at||null)
  };
}

export async function exchangeTikTokCode({clientKey,clientSecret,code,redirectUri,fetchFn=fetch,nowMs=Date.now()}){
  if(!code)throw new Error('TikTok authorization code is required');
  const data=await tokenRequest({clientKey,clientSecret,fetchFn,body:{grant_type:'authorization_code',code,redirect_uri:redirectUri}});
  return tiktokTokenBundle(data,nowMs);
}

export async function refreshTikTokToken({clientKey,clientSecret,bundle,fetchFn=fetch,nowMs=Date.now()}){
  if(!bundle?.refresh_token)throw new Error('TikTok refresh token is missing; reconnect TikTok');
  const data=await tokenRequest({clientKey,clientSecret,fetchFn,body:{grant_type:'refresh_token',refresh_token:bundle.refresh_token}});
  return tiktokTokenBundle(data,nowMs,bundle);
}

export function parseTikTokSecret(secret){
  const raw=String(secret||'').trim();
  if(!raw)return null;
  if(!raw.startsWith('{'))return {access_token:raw,refresh_token:'',open_id:'',scope:'',access_expires_at:null,refresh_expires_at:null};
  try{
    const parsed=JSON.parse(raw);
    if(!parsed?.access_token)throw new Error('missing access_token');
    return parsed;
  }catch(e){throw new Error(`TikTok credential bundle is invalid: ${e.message||e}`);}
}

export function tiktokTokenNeedsRefresh(bundle,nowMs=Date.now(),leadMs=60*60*1000){
  if(!bundle?.access_expires_at)return false;
  const expires=Date.parse(bundle.access_expires_at);
  return Number.isFinite(expires)&&expires-nowMs<=leadMs;
}
