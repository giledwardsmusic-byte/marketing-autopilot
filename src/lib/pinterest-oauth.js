const TOKEN_URL='https://api.pinterest.com/v5/oauth/token';
const AUTH_URL='https://www.pinterest.com/oauth/';
export const PINTEREST_SCOPES=Object.freeze(['boards:read','boards:write','pins:read','pins:write']);

function basic(clientId,clientSecret){
  if(!clientId||!clientSecret)throw new Error('Pinterest client ID and secret are required');
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export function pinterestRedirectUri(env,origin){
  return env?.PINTEREST_REDIRECT_URI||`${String(origin||'').replace(/\/$/,'')}/oauth/pinterest/callback`;
}

export function pinterestAuthorizationUrl({clientId,redirectUri,state,scopes=PINTEREST_SCOPES}){
  if(!clientId)throw new Error('Pinterest client ID is required');
  if(!redirectUri||!/^https:\/\//i.test(redirectUri))throw new Error('Pinterest redirect URI must be HTTPS');
  if(!state)throw new Error('Pinterest OAuth state is required');
  const u=new URL(AUTH_URL);
  u.searchParams.set('client_id',clientId);
  u.searchParams.set('redirect_uri',redirectUri);
  u.searchParams.set('response_type','code');
  u.searchParams.set('scope',scopes.join(','));
  u.searchParams.set('state',state);
  return u.toString();
}

async function tokenRequest({clientId,clientSecret,body,fetchFn=fetch}){
  const r=await fetchFn(TOKEN_URL,{method:'POST',headers:{authorization:basic(clientId,clientSecret),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.access_token)throw new Error(`Pinterest OAuth ${r.status}: ${data?.message||data?.error_description||data?.error||'token request failed'}`);
  return data;
}

export function pinterestTokenBundle(data,nowMs=Date.now(),previous={}){
  if(!data?.access_token)throw new Error('Pinterest returned no access token');
  const accessSeconds=Math.max(0,Number(data.expires_in||0));
  const refreshSeconds=Math.max(0,Number(data.refresh_token_expires_in||0));
  return {
    access_token:String(data.access_token),
    refresh_token:String(data.refresh_token||previous.refresh_token||''),
    scope:String(data.scope||previous.scope||''),
    token_type:String(data.token_type||'bearer'),
    access_expires_at:accessSeconds?new Date(nowMs+accessSeconds*1000).toISOString():(previous.access_expires_at||null),
    refresh_expires_at:data.refresh_token_expires_at?new Date(Number(data.refresh_token_expires_at)*1000).toISOString():(refreshSeconds?new Date(nowMs+refreshSeconds*1000).toISOString():(previous.refresh_expires_at||null))
  };
}

export async function exchangePinterestCode({clientId,clientSecret,code,redirectUri,fetchFn=fetch,nowMs=Date.now()}){
  if(!code)throw new Error('Pinterest authorization code is required');
  const data=await tokenRequest({clientId,clientSecret,fetchFn,body:{grant_type:'authorization_code',code,redirect_uri:redirectUri}});
  return pinterestTokenBundle(data,nowMs);
}

export async function refreshPinterestToken({clientId,clientSecret,bundle,fetchFn=fetch,nowMs=Date.now()}){
  if(!bundle?.refresh_token)throw new Error('Pinterest refresh token is missing; reconnect Pinterest');
  const data=await tokenRequest({clientId,clientSecret,fetchFn,body:{grant_type:'refresh_token',refresh_token:bundle.refresh_token}});
  return pinterestTokenBundle(data,nowMs,bundle);
}

export function parsePinterestSecret(secret){
  const raw=String(secret||'').trim();
  if(!raw)return null;
  if(!raw.startsWith('{'))return {access_token:raw,refresh_token:'',scope:'',access_expires_at:null,refresh_expires_at:null};
  try{
    const parsed=JSON.parse(raw);
    if(!parsed?.access_token)throw new Error('missing access_token');
    return parsed;
  }catch(e){throw new Error(`Pinterest credential bundle is invalid: ${e.message||e}`);}
}

export function pinterestTokenNeedsRefresh(bundle,nowMs=Date.now(),leadMs=7*24*60*60*1000){
  if(!bundle?.access_expires_at)return false;
  const expires=Date.parse(bundle.access_expires_at);
  return Number.isFinite(expires)&&expires-nowMs<=leadMs;
}
