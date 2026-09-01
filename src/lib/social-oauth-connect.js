import { encryptCredential, decryptCredential, randomToken } from './security.js';
import { nowIso } from './utils.js';
import { pinterestAuthorizationUrl, pinterestRedirectUri, exchangePinterestCode, refreshPinterestToken } from './pinterest-oauth.js';
import { tiktokAuthorizationUrl, tiktokRedirectUri, exchangeTikTokCode, refreshTikTokToken } from './tiktok-oauth.js';

const STATE_TTL_MS=15*60*1000;
const PINTEREST_API='https://api.pinterest.com/v5';

function parseConfig(raw){try{return JSON.parse(raw||'{}')}catch{return {}}}
function stateKey(platform){return `oauth:${platform}:state`;}

async function storeState(env,platform,state,origin){
  const value=JSON.stringify({state,origin,expires_at:new Date(Date.now()+STATE_TTL_MS).toISOString()});
  await env.DB.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(stateKey(platform),value,nowIso()).run();
}

async function consumeState(env,platform,state){
  const row=await env.DB.prepare(`SELECT value_json FROM settings WHERE key=?`).bind(stateKey(platform)).first();
  if(!row)throw new Error(`${platform} authorization session was not found; start the connection again`);
  const saved=parseConfig(row.value_json);
  await env.DB.prepare(`DELETE FROM settings WHERE key=?`).bind(stateKey(platform)).run();
  if(!state||saved.state!==state)throw new Error(`${platform} authorization state did not match`);
  if(!saved.expires_at||Date.parse(saved.expires_at)<=Date.now())throw new Error(`${platform} authorization session expired; start the connection again`);
  return saved;
}

function requirePinterestEnv(env){
  if(!env.PINTEREST_CLIENT_ID||!env.PINTEREST_CLIENT_SECRET)throw new Error('Pinterest app credentials are not configured yet');
}
function requireTikTokEnv(env){
  if(!env.TIKTOK_CLIENT_KEY||!env.TIKTOK_CLIENT_SECRET)throw new Error('TikTok app credentials are not configured yet');
}

export async function beginPinterestOAuth(env,origin){
  requirePinterestEnv(env);
  const state=randomToken(32); const redirectUri=pinterestRedirectUri(env,origin);
  await storeState(env,'pinterest',state,origin);
  return {url:pinterestAuthorizationUrl({clientId:env.PINTEREST_CLIENT_ID,redirectUri,state}),redirect_uri:redirectUri};
}

export async function beginTikTokOAuth(env,origin){
  requireTikTokEnv(env);
  const state=randomToken(32); const redirectUri=tiktokRedirectUri(env,origin);
  await storeState(env,'tiktok',state,origin);
  return {url:tiktokAuthorizationUrl({clientKey:env.TIKTOK_CLIENT_KEY,redirectUri,state}),redirect_uri:redirectUri};
}

async function pinterestBoards(token,fetchFn=fetch){
  const r=await fetchFn(`${PINTEREST_API}/boards?page_size=100`,{headers:{accept:'application/json',authorization:`Bearer ${token}`}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Pinterest boards ${r.status}: ${data?.message||data?.error||'request failed'}`);
  return Array.isArray(data?.items)?data.items:[];
}
function isTableRockBoardName(name){
  const n=String(name||'').trim().toLowerCase();
  return n==='table rock press'||n.includes('table rock');
}
function selectPinterestBoard(boards){
  return boards.find(b=>String(b?.name||'').trim().toLowerCase()==='table rock press')||boards.find(b=>isTableRockBoardName(b?.name))||null;
}

async function encryptedRefresh(env,refreshToken){
  if(!refreshToken)return {refresh_ciphertext:null,refresh_iv:null};
  const x=await encryptCredential(env,refreshToken); return {refresh_ciphertext:x.ciphertext,refresh_iv:x.iv};
}

async function upsertConnector(env,{platform,connectorType,name,accessToken,config}){
  const enc=await encryptCredential(env,accessToken); const t=nowIso();
  const existing=await env.DB.prepare(`SELECT id FROM connectors WHERE platform=? AND connector_type=? ORDER BY priority ASC LIMIT 1`).bind(platform,connectorType).first();
  if(existing){
    await env.DB.prepare(`UPDATE connectors SET name=?,enabled=1,priority=10,cost_cents_per_post=0,config_json=?,secret_ciphertext=?,secret_iv=?,last_error_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
      .bind(name,JSON.stringify(config),enc.ciphertext,enc.iv,t,existing.id).run();
    return existing.id;
  }
  const id=`con_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,secret_ciphertext,secret_iv,created_at,updated_at) VALUES(?,?,?,?,1,10,0,?,?,?,?,?)`)
    .bind(id,name,connectorType,platform,JSON.stringify(config),enc.ciphertext,enc.iv,t,t).run();
  return id;
}

export async function completePinterestOAuth(env,{origin,state,code,fetchFn=fetch}){
  requirePinterestEnv(env); await consumeState(env,'pinterest',state);
  const redirectUri=pinterestRedirectUri(env,origin);
  const bundle=await exchangePinterestCode({clientId:env.PINTEREST_CLIENT_ID,clientSecret:env.PINTEREST_CLIENT_SECRET,code,redirectUri,fetchFn});
  const boards=await pinterestBoards(bundle.access_token,fetchFn); const board=selectPinterestBoard(boards);
  if(!board?.id){
    await env.DB.prepare(`UPDATE connectors SET enabled=0,last_error_at=?,last_error=?,updated_at=? WHERE platform='pinterest' AND connector_type='pinterest'`)
      .bind(nowIso(),'No Table Rock Press Pinterest board is available; publishing disabled to prevent posts going to an unrelated board.',nowIso()).run();
    throw new Error('Pinterest authorized, but no Table Rock Press board is available. Create a Pinterest board named "Table Rock Press", then reconnect Pinterest.');
  }
  const refresh=await encryptedRefresh(env,bundle.refresh_token);
  const config={board_id:String(board.id),board_name:String(board.name||'Pinterest'),scope:bundle.scope||'',access_expires_at:bundle.access_expires_at||null,refresh_expires_at:bundle.refresh_expires_at||null,...refresh};
  const id=await upsertConnector(env,{platform:'pinterest',connectorType:'pinterest',name:`Pinterest → ${board.name||'board'}`,accessToken:bundle.access_token,config});
  return {id,board_id:String(board.id),board_name:String(board.name||'Pinterest')};
}

export async function completeTikTokOAuth(env,{origin,state,code,fetchFn=fetch}){
  requireTikTokEnv(env); await consumeState(env,'tiktok',state);
  const redirectUri=tiktokRedirectUri(env,origin);
  const bundle=await exchangeTikTokCode({clientKey:env.TIKTOK_CLIENT_KEY,clientSecret:env.TIKTOK_CLIENT_SECRET,code,redirectUri,fetchFn});
  const refresh=await encryptedRefresh(env,bundle.refresh_token);
  const config={open_id:bundle.open_id||'',scope:bundle.scope||'',access_expires_at:bundle.access_expires_at||null,refresh_expires_at:bundle.refresh_expires_at||null,brand_organic:true,...refresh};
  const id=await upsertConnector(env,{platform:'tiktok',connectorType:'tiktok',name:'TikTok',accessToken:bundle.access_token,config});
  return {id,open_id:bundle.open_id||null};
}

async function refreshOne(env,c,platform,fetchFn=fetch){
  const cfg=parseConfig(c.config_json); const expires=Date.parse(cfg.access_expires_at||'');
  const lead=platform==='pinterest'?7*24*60*60*1000:60*60*1000;
  if(!Number.isFinite(expires)||expires-Date.now()>lead)return {id:c.id,state:'fresh'};
  if(!cfg.refresh_ciphertext||!cfg.refresh_iv)throw new Error(`${platform} refresh token is missing; reconnect ${platform}`);
  const access=await decryptCredential(env,c.secret_ciphertext,c.secret_iv);
  const refreshToken=await decryptCredential(env,cfg.refresh_ciphertext,cfg.refresh_iv);
  const previous={access_token:access,refresh_token:refreshToken,scope:cfg.scope||'',open_id:cfg.open_id||'',access_expires_at:cfg.access_expires_at||null,refresh_expires_at:cfg.refresh_expires_at||null};
  const bundle=platform==='pinterest'
    ? await refreshPinterestToken({clientId:env.PINTEREST_CLIENT_ID,clientSecret:env.PINTEREST_CLIENT_SECRET,bundle:previous,fetchFn})
    : await refreshTikTokToken({clientKey:env.TIKTOK_CLIENT_KEY,clientSecret:env.TIKTOK_CLIENT_SECRET,bundle:previous,fetchFn});
  const accessEnc=await encryptCredential(env,bundle.access_token); const refreshEnc=await encryptedRefresh(env,bundle.refresh_token);
  const next={...cfg,scope:bundle.scope||cfg.scope||'',open_id:bundle.open_id||cfg.open_id||'',access_expires_at:bundle.access_expires_at||null,refresh_expires_at:bundle.refresh_expires_at||null,...refreshEnc};
  await env.DB.prepare(`UPDATE connectors SET secret_ciphertext=?,secret_iv=?,config_json=?,last_error=NULL,last_error_at=NULL,updated_at=? WHERE id=?`)
    .bind(accessEnc.ciphertext,accessEnc.iv,JSON.stringify(next),nowIso(),c.id).run();
  return {id:c.id,state:'refreshed'};
}

export async function refreshSocialOAuthConnectors(env,{fetchFn=fetch}={}){
  const rows=(await env.DB.prepare(`SELECT * FROM connectors WHERE enabled=1 AND ((platform='pinterest' AND connector_type='pinterest') OR (platform='tiktok' AND connector_type='tiktok'))`).all()).results||[];
  const results=[];
  for(const c of rows){
    try{
      if(c.platform==='pinterest'){
        requirePinterestEnv(env);
        const cfg=parseConfig(c.config_json);
        if(!isTableRockBoardName(cfg.board_name)){
          await env.DB.prepare(`UPDATE connectors SET enabled=0,last_error_at=?,last_error=?,updated_at=? WHERE id=?`)
            .bind(nowIso(),'Pinterest connector disabled because its publishing board is not a Table Rock Press board.',nowIso(),c.id).run();
          results.push({id:c.id,state:'failed',error:'Pinterest publishing board is not a Table Rock Press board; connector disabled'});
          continue;
        }
      }else requireTikTokEnv(env);
      results.push(await refreshOne(env,c,c.platform,fetchFn));
    }catch(e){
      await env.DB.prepare(`UPDATE connectors SET last_error_at=?,last_error=?,updated_at=? WHERE id=?`).bind(nowIso(),`OAuth refresh: ${String(e.message||e).slice(0,700)}`,nowIso(),c.id).run();
      results.push({id:c.id,state:'failed',error:String(e.message||e)});
    }
  }
  return results;
}
