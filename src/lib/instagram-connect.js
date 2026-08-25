import { decryptCredential } from './security.js';
import { nowIso } from './utils.js';

const DEFAULT_GRAPH_HOST='https://graph.facebook.com';

function parseConfig(raw){
  try{return JSON.parse(raw||'{}')}catch{return {}}
}

export async function discoverInstagramBusinessAccount({pageId,pageAccessToken,apiVersion='v25.0',host=DEFAULT_GRAPH_HOST,fetchFn=fetch}){
  if(!pageId)throw new Error('Facebook Page ID is missing');
  if(!pageAccessToken)throw new Error('Facebook Page access token is missing');
  const base=String(host||DEFAULT_GRAPH_HOST).replace(/\/$/,'');
  const params=new URLSearchParams({fields:'instagram_business_account{id,username}',access_token:pageAccessToken});
  const r=await fetchFn(`${base}/${apiVersion}/${encodeURIComponent(pageId)}?${params.toString()}`);
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data?.error)throw new Error(`Meta Instagram discovery ${r.status}: ${data?.error?.message||data?.message||'request failed'}`);
  const account=data?.instagram_business_account;
  if(!account?.id)throw new Error('No Instagram professional account is linked to this Facebook Page');
  return {ig_user_id:String(account.id),username:account.username?String(account.username):null};
}

export async function connectInstagramFromFacebook(env,{fetchFn=fetch}={}){
  const fb=await env.DB.prepare(`SELECT * FROM connectors WHERE platform='facebook' AND connector_type='meta_facebook' AND enabled=1 ORDER BY priority ASC LIMIT 1`).first();
  if(!fb)throw new Error('Facebook must be connected before Instagram can be linked');
  const cfg=parseConfig(fb.config_json);
  if(!cfg.page_id)throw new Error('Connected Facebook route is missing its Page ID');
  const token=await decryptCredential(env,fb.secret_ciphertext,fb.secret_iv);
  const account=await discoverInstagramBusinessAccount({
    pageId:cfg.page_id,
    pageAccessToken:token,
    apiVersion:cfg.api_version||'v25.0',
    host:cfg.host||DEFAULT_GRAPH_HOST,
    fetchFn
  });
  const t=nowIso();
  const igConfig={ig_user_id:account.ig_user_id,username:account.username||undefined,api_version:cfg.api_version||'v25.0',host:cfg.host||DEFAULT_GRAPH_HOST,source_page_id:String(cfg.page_id)};
  const existing=await env.DB.prepare(`SELECT id FROM connectors WHERE platform='instagram' AND connector_type='meta_instagram' ORDER BY priority ASC LIMIT 1`).first();
  if(existing){
    await env.DB.prepare(`UPDATE connectors SET name=?,enabled=1,priority=10,cost_cents_per_post=0,config_json=?,secret_ciphertext=?,secret_iv=?,last_error_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
      .bind(account.username?`Instagram @${account.username}`:'Table Rock Press Instagram',JSON.stringify(igConfig),fb.secret_ciphertext,fb.secret_iv,t,existing.id).run();
    return {id:existing.id,updated:true,...account};
  }
  const id=`con_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,secret_ciphertext,secret_iv,created_at,updated_at) VALUES(?,?, 'meta_instagram','instagram',1,10,0,?,?,?,?,?)`)
    .bind(id,account.username?`Instagram @${account.username}`:'Table Rock Press Instagram',JSON.stringify(igConfig),fb.secret_ciphertext,fb.secret_iv,t,t).run();
  return {id,updated:false,...account};
}
