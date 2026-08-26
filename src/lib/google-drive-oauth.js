import { setSetting, setting } from './db.js';

const STATE_KEY='google_drive_oauth_state';
const SCOPE='https://www.googleapis.com/auth/drive';

export function googleDriveRedirectUri(origin){
  return `${String(origin||'').replace(/\/$/,'')}/oauth/google-drive/callback`;
}

export async function beginGoogleDriveOAuth(env,origin){
  if(!env.GOOGLE_DRIVE_CLIENT_ID)throw new Error('GOOGLE_DRIVE_CLIENT_ID is not configured');
  if(!env.GOOGLE_DRIVE_CLIENT_SECRET)throw new Error('GOOGLE_DRIVE_CLIENT_SECRET is not configured');
  const state=crypto.randomUUID();
  await setSetting(env,STATE_KEY,{state,created_at:new Date().toISOString()});
  const p=new URLSearchParams({
    client_id:env.GOOGLE_DRIVE_CLIENT_ID,
    redirect_uri:googleDriveRedirectUri(origin),
    response_type:'code',
    scope:SCOPE,
    access_type:'offline',
    prompt:'consent',
    include_granted_scopes:'true',
    state
  });
  return {authorization_url:`https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`,redirect_uri:googleDriveRedirectUri(origin)};
}

export async function completeGoogleDriveOAuth(env,{origin,state,code}){
  if(!env.GOOGLE_DRIVE_CLIENT_ID||!env.GOOGLE_DRIVE_CLIENT_SECRET)throw new Error('Google Drive OAuth client credentials are not configured');
  if(!state||!code)throw new Error('Google OAuth callback is missing state or code');
  const saved=await setting(env,STATE_KEY,null);
  if(!saved?.state||saved.state!==state)throw new Error('Google OAuth state mismatch');
  const created=Date.parse(saved.created_at||'');
  if(!Number.isFinite(created)||Date.now()-created>15*60*1000)throw new Error('Google OAuth state expired; start the connection again');
  const body=new URLSearchParams({
    client_id:env.GOOGLE_DRIVE_CLIENT_ID,
    client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,
    code,
    grant_type:'authorization_code',
    redirect_uri:googleDriveRedirectUri(origin)
  });
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Google OAuth token exchange failed (${r.status}): ${data.error_description||data.error||'unknown error'}`);
  if(!data.refresh_token)throw new Error('Google did not return a refresh token. Revoke the app grant and authorize again with consent.');
  await setSetting(env,STATE_KEY,{used_at:new Date().toISOString()});
  return {refresh_token:data.refresh_token,scope:data.scope||SCOPE,token_type:data.token_type||'Bearer'};
}
